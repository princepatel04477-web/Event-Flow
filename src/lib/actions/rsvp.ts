'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { friendlyDbError } from '@/lib/errors'
import { rsvpLogSchema, type GuestGroupRow } from '@/lib/rsvp-log'
import type { Database } from '@/lib/supabase/database.types'

export type RsvpSaveResult =
  | { ok: true; group: GuestGroupRow }
  | { ok: false; reason: 'error'; message: string }

/**
 * Save the RSVP outcome + travel form in ONE database transaction via the
 * `save_rsvp_log` RPC (see migration 1600). Why an RPC and not a sequence of
 * table updates:
 *
 *   - Atomicity. guest_groups + up to two travel_legs rows must land
 *     together. A crashed update half-way leaves a confirmed family with no
 *     travel record, and the caller lock released.
 *   - Server clock only. The RPC stamps created_at/updated_at from now();
 *     no timestamp crosses the wire from the browser.
 *   - RLS once. The RPC runs security definer and fences on
 *     `app.is_staff(event_id)`, exactly like claim_group().
 *   - The caller lock is released inside the same transaction as the
 *     outcome, so "logged + released" can never half-happen.
 *
 * Validation: the Zod schema runs here, at the system boundary, and rejects
 * before any write. It is the same schema the form uses, so a crafted
 * request and a mistyped form are caught by the same rules.
 */
export async function saveRsvpLog(input: {
  eventId: string
  eventCode: string
  groupId: string
  values: unknown
}): Promise<RsvpSaveResult> {
  const parsed = rsvpLogSchema.safeParse(input.values)

  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const where =
      first && first.path.length > 0
        ? ` (${first.path.join('.')})`
        : ''
    return {
      ok: false,
      reason: 'error',
      message: `${first?.message ?? 'The form has a problem.'}${where}`,
    }
  }

  const supabase = await createClient()

  // Scope check BEFORE the RPC, mirroring claimGroupForCall: the RPC fences
  // on the GROUP's own event, so an admin calling with a foreign group id
  // would succeed and release a lock in another event.
  const { data: scoped } = await supabase
    .from('guest_groups')
    .select('id')
    .eq('id', input.groupId)
    .eq('event_id', input.eventId)
    .maybeSingle()

  if (!scoped) {
    return {
      ok: false,
      reason: 'error',
      message: 'This family is not part of this event, or your access changed. Refresh the queue.',
    }
  }

  const v = parsed.data

  // The RPC's nullable params (migration 1600): `p_adults_confirmed` /
  // `p_children_confirmed` are nullable `integer`, `p_callback_at` is
  // nullable `timestamptz`, `p_notes` is nullable `text`. `supabase gen
  // types` over-infers them as non-nullable, so the args object is
  // asserted to the RPC's true contract — nulls are meaningful (blank
  // stepper = NULL, not 0) and must survive to the database.
  const args = {
    p_event_id: input.eventId,
    p_group_id: input.groupId,
    p_rsvp_status: v.rsvpStatus,
    p_adults_confirmed: nonNegativeIntOrNull(v.adultsConfirmed),
    p_children_confirmed: nonNegativeIntOrNull(v.childrenConfirmed),
    p_needs_pickup: v.needsPickup,
    p_special_requirements: v.specialRequirements,
    p_callback_at: v.callbackDatetime ? new Date(v.callbackDatetime).toISOString() : null,
    p_notes: v.notes.trim() ? v.notes.trim() : null,
    p_arrival: buildLegPayload(v.arrival),
    p_departure: buildLegPayload(v.departure),
  } as Database['public']['Functions']['save_rsvp_log']['Args']

  const { data, error } = await supabase.rpc('save_rsvp_log', args)

  if (error) {
    return { ok: false, reason: 'error', message: friendlyDbError(error) }
  }

  if (!data || data.event_id !== input.eventId) {
    return {
      ok: false,
      reason: 'error',
      message:
        'Nothing was saved — the database matched no such family for your account. ' +
        'Your session may have expired. Sign in again; your entry is still on this phone.',
    }
  }

  // Handle split arrival legs & pax_on_leg
  if (v.arrival.paxOnLeg !== undefined || v.splitArrival) {
    const { data: existingArrivalLegs } = await supabase
      .from('travel_legs')
      .select('id, direction, mode')
      .eq('group_id', input.groupId)
      .eq('direction', 'arrival')
      .order('created_at', { ascending: true })

    const primaryLeg = existingArrivalLegs?.[0]
    if (primaryLeg && v.arrival.paxOnLeg !== undefined) {
      const pax =
        typeof v.arrival.paxOnLeg === 'number'
          ? v.arrival.paxOnLeg
          : nonNegativeIntOrNull(String(v.arrival.paxOnLeg ?? ''))
      if (pax !== null) {
        await supabase
          .from('travel_legs')
          .update({ pax_on_leg: pax })
          .eq('id', primaryLeg.id)
      }
    }

    if (v.splitArrival && v.splitArrival.mode) {
      const splitMode = v.splitArrival.mode as Database['app']['Enums']['travel_mode']
      const splitPax =
        typeof v.splitArrival.paxOnLeg === 'number'
          ? v.splitArrival.paxOnLeg
          : nonNegativeIntOrNull(String(v.splitArrival.paxOnLeg ?? ''))

      const secondaryLeg = existingArrivalLegs?.[1]
      if (secondaryLeg) {
        await supabase
          .from('travel_legs')
          .update({
            mode: splitMode,
            travel_date: v.splitArrival.date || v.arrival.date || null,
            travel_time: v.splitArrival.time || null,
            reference: v.splitArrival.flightTrainNo?.trim() || null,
            point: v.splitArrival.location?.trim() || null,
            pax_on_leg: splitPax,
            needs_transport: v.needsPickup,
            updated_at: new Date().toISOString(),
          })
          .eq('id', secondaryLeg.id)
      } else {
        await supabase
          .from('travel_legs')
          .insert({
            event_id: input.eventId,
            group_id: input.groupId,
            direction: 'arrival',
            mode: splitMode,
            travel_date: v.splitArrival.date || v.arrival.date || null,
            travel_time: v.splitArrival.time || null,
            reference: v.splitArrival.flightTrainNo?.trim() || null,
            point: v.splitArrival.location?.trim() || null,
            pax_on_leg: splitPax,
            needs_transport: v.needsPickup,
            source: 'rsvp_call',
          })
      }
    } else if (existingArrivalLegs && existingArrivalLegs.length > 1 && !v.splitArrival) {
      const extraIds = existingArrivalLegs.slice(1).map((l) => l.id)
      await supabase.from('travel_legs').delete().in('id', extraIds)
    }
  }

  revalidatePath(`/${input.eventCode}/rsvp/queue`)
  revalidatePath(`/${input.eventCode}/rsvp/status/${input.groupId}`)
  revalidatePath(`/${input.eventCode}/families/${input.groupId}`)
  revalidatePath(`/${input.eventCode}/logistics/arrivals`)

  return { ok: true, group: data }
}

function nonNegativeIntOrNull(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  if (!/^\d+$/.test(trimmed)) return null
  const n = Number(trimmed)
  return Number.isSafeInteger(n) ? n : null
}

/**
 * Build the JSON leg payload for the RPC. Blank means "leave the existing
 * value alone" (the RPC coalesces), so the form can never accidentally
 * clear a field it did not touch.
 */
function buildLegPayload(leg: { mode: string; date: string; time: string; location: string; flightTrainNo: string }) {
  const mode = norm(leg.mode)
  const date = norm(leg.date)
  const time = norm(leg.time)
  const location = norm(leg.location)
  const flightTrainNo = norm(leg.flightTrainNo)

  if (!mode && !date && !time && !location && !flightTrainNo) return null

  return {
    mode,
    date,
    time,
    point: location,
    reference: flightTrainNo,
  }
}

function norm(raw: string): string | null {
  const trimmed = raw.trim()
  return trimmed === '' ? null : trimmed
}
