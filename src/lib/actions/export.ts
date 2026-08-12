'use server'

import { createClient } from '@/lib/supabase/server'
import { getEventAccess } from '@/lib/supabase/queries'
import type { ExportData } from '@/lib/export/sheets'

export type ExportDataResult =
  | { ok: true; eventName: string; data: ExportData }
  | { ok: false; message: string }

const NOT_STAFF_MESSAGE =
  'You are not staff on this event, so its data is invisible to your account. ' +
  'Nothing was read and nothing was written — ask an admin to add you as event_team.'

/**
 * Fetch everything the export workbook needs, as the signed-in staff user
 * (RLS applies — a client gets zero rows and NO error, which is exactly why
 * the access gate runs first).
 *
 * The rows are handed to the browser, which builds the .xlsx client-side via
 * SheetJS (no server file round-trip). All values are server-stamped already
 * — nothing here invents a timestamp.
 */
export async function readExportData(eventId: string): Promise<ExportDataResult> {
  const access = await getEventAccess(eventId)
  if (access !== 'admin' && access !== 'event_team') {
    return { ok: false, message: NOT_STAFF_MESSAGE }
  }

  const supabase = await createClient()

  const [{ data: event }, ...rest] = await Promise.all([
    supabase.from('events').select('name').eq('id', eventId).maybeSingle(),
    supabase.from('guest_groups').select('*').eq('event_id', eventId),
    supabase.from('travel_legs').select('*').eq('event_id', eventId),
    supabase.from('deliverables').select('*').eq('event_id', eventId),
    supabase.from('delivery_proofs').select('*').eq('event_id', eventId),
    supabase.from('room_assignments').select('*').eq('event_id', eventId),
    supabase.from('rooms').select('*').eq('event_id', eventId),
    supabase.from('hotels').select('*').eq('event_id', eventId),
    // profiles is global (keyed by auth user id), not event-scoped.
    supabase.from('profiles').select('id, full_name').limit(1000),
    // staff_members resolves captured_by_staff on code-auth proofs.
    supabase.from('staff_members').select('id, full_name').eq('event_id', eventId),
    // Call log + extraction audit (N6 export sheets 6-8)
    supabase.from('call_attempts').select('*').eq('event_id', eventId),
    supabase.from('rsvp_extractions').select('*').eq('event_id', eventId),
  ])

  const failure = rest.find((r) => r.error)
  if (failure?.error) {
    return { ok: false, message: `Could not read export data: ${failure.error.message}` }
  }

  const [groups, legs, deliverables, proofs, assignments, rooms, hotels, profiles, staffMembers, callAttempts, extractions] = rest

  const profileNames: Record<string, string> = {}
  for (const p of profiles.data ?? []) {
    if (p.id) profileNames[p.id] = p.full_name ?? p.id.slice(0, 8)
  }

  // Code-auth proofs record captured_by_staff (a staff_members.id); legacy
  // and admin proofs record captured_by (an auth user id). Resolve both.
  const staffNames: Record<string, string> = {}
  for (const s of staffMembers.data ?? []) {
    if (s.id) staffNames[s.id] = s.full_name
  }

  return {
    ok: true,
    eventName: event?.name ?? 'Event',
    data: {
      groups: groups.data ?? [],
      legs: legs.data ?? [],
      deliverables: deliverables.data ?? [],
      proofs: proofs.data ?? [],
      assignments: assignments.data ?? [],
      rooms: rooms.data ?? [],
      hotels: hotels.data ?? [],
      callAttempts: callAttempts.data ?? [],
      extractions: extractions.data ?? [],
      profileNames,
      staffNames,
    },
  }
}
