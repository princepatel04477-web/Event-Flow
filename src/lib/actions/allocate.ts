'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { friendlyDbError } from '@/lib/errors'
import { loadAllocationPlan } from '@/lib/rooms/loadAllocation'

export type CommitResult =
  | {
      ok: true
      guestsAssigned: number
      familiesAssigned: number
      sharesSkipped: number
    }
  | { ok: false; error: string }

/**
 * Commit the proposed allocation.
 *
 * The plan is recomputed here rather than accepted from the client: a posted
 * plan could be minutes stale, and rooms move underneath it. The screen the
 * user approved is a rendering of this same computation.
 *
 * `approvedShareRoomIds` is the safety valve on rule (d). Any room this run
 * would put two DIFFERENT groups into is dropped unless its id appears in
 * that list — so two strangers are never committed into one room without a
 * tick against that specific room.
 *
 * Atomic by construction: a single multi-row INSERT is one statement and so
 * one transaction. Either every assignment lands or none does.
 */
export async function commitAllocation(
  eventId: string,
  eventCode: string,
  approvedShareRoomIds: string[],
): Promise<CommitResult> {
  const loaded = await loadAllocationPlan(eventId)
  if (loaded.error) return { ok: false, error: loaded.error }

  const approved = new Set(approvedShareRoomIds)
  const sharedRooms = new Set(loaded.plan.shares.map((s) => s.roomId))

  const rows: { event_id: string; room_id: string; guest_id: string; group_id: string }[] = []
  let sharesSkipped = 0
  const familiesTouched = new Set<string>()

  for (const family of loaded.plan.placements) {
    for (const room of family.rooms) {
      if (sharedRooms.has(room.roomId) && !approved.has(room.roomId)) {
        sharesSkipped += room.guests.length
        continue
      }
      for (const guest of room.guests) {
        rows.push({
          event_id: eventId,
          room_id: room.roomId,
          guest_id: guest.id,
          group_id: family.groupId,
        })
        familiesTouched.add(family.groupId)
      }
    }
  }

  if (rows.length === 0) {
    return { ok: true, guestsAssigned: 0, familiesAssigned: 0, sharesSkipped }
  }

  const supabase = await createClient()

  // Plain INSERT, not upsert: `room_assignments_one_active_per_guest` is a
  // PARTIAL unique index (`where released_at is null`) and ON CONFLICT cannot
  // target it. The loader has already excluded every guest holding an active
  // assignment, so a 23505 means one appeared since the preview.
  const { data, error } = await supabase.from('room_assignments').insert(rows).select('id')

  if (error) {
    if (error.code === '23505') {
      return {
        ok: false,
        error:
          'Somebody was given a room while this proposal was on screen, so nothing was written. ' +
          'Reload to get a fresh proposal — already-placed guests are never moved.',
      }
    }
    if (error.code === '23514') {
      return {
        ok: false,
        error:
          'The database refused a placement for exceeding a room capacity, so nothing was ' +
          'written. Reload the proposal and try again.',
      }
    }
    return { ok: false, error: friendlyDbError(error) }
  }

  revalidateRooms(eventCode)

  return {
    ok: true,
    guestsAssigned: data?.length ?? 0,
    familiesAssigned: familiesTouched.size,
    sharesSkipped,
  }
}

// ---------------------------------------------------------------------
// WhatsApp queue
// ---------------------------------------------------------------------

export type QueueResult = { ok: true; queued: number } | { ok: false; error: string }

function fillTemplate(body: string, values: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, key: string) => values[key] ?? '')
}

/**
 * Queue `room_allocated` messages for every family that now has a room.
 *
 * Queue only — status stays `queued` and nothing is sent. Sending is Phase 5.
 * The body is rendered now rather than at send time so the message that was
 * approved is the message that goes out, even if the template is edited later.
 */
export async function queueRoomMessages(
  eventId: string,
  eventCode: string,
): Promise<QueueResult> {
  const supabase = await createClient()

  const [templateRes, assignmentsRes] = await Promise.all([
    // Event-specific template wins over the global one (`event_id is null`).
    supabase
      .from('message_templates')
      .select('body, event_id')
      .eq('key', 'room_allocated')
      .eq('is_active', true)
      .or(`event_id.eq.${eventId},event_id.is.null`),
    supabase
      .from('room_assignments')
      .select(
        'group_id, check_in_time, guest_groups(head_name, primary_mobile), rooms(room_number, hotels(name))',
      )
      .eq('event_id', eventId)
      .is('released_at', null),
  ])

  if (templateRes.error) return { ok: false, error: friendlyDbError(templateRes.error) }
  if (assignmentsRes.error) return { ok: false, error: friendlyDbError(assignmentsRes.error) }

  const template =
    (templateRes.data ?? []).find((t) => t.event_id === eventId) ?? (templateRes.data ?? [])[0]

  if (!template) {
    return { ok: false, error: 'No active "room_allocated" message template exists.' }
  }

  type Row = {
    group_id: string
    check_in_time: string | null
    guest_groups: { head_name: string; primary_mobile: string | null } | null
    rooms: { room_number: string; hotels: { name: string } | null } | null
  }

  // One message per family, not per guest — the head answers for the family.
  const byGroup = new Map<string, { rooms: string[]; row: Row }>()
  for (const row of (assignmentsRes.data ?? []) as unknown as Row[]) {
    if (!row.guest_groups?.primary_mobile || !row.rooms) continue
    const current = byGroup.get(row.group_id)
    if (current) {
      if (!current.rooms.includes(row.rooms.room_number)) current.rooms.push(row.rooms.room_number)
    } else {
      byGroup.set(row.group_id, { rooms: [row.rooms.room_number], row })
    }
  }

  // Never queue a second copy for a family that already has one waiting.
  const { data: existing, error: existingError } = await supabase
    .from('messages')
    .select('group_id')
    .eq('event_id', eventId)
    .eq('template_key', 'room_allocated')
    .eq('status', 'queued')

  if (existingError) return { ok: false, error: friendlyDbError(existingError) }
  const alreadyQueued = new Set((existing ?? []).map((m) => m.group_id))

  const messages = [...byGroup.entries()]
    .filter(([groupId]) => !alreadyQueued.has(groupId))
    .map(([groupId, { rooms, row }]) => ({
      event_id: eventId,
      group_id: groupId,
      to_number: row.guest_groups!.primary_mobile!,
      template_key: 'room_allocated',
      body: fillTemplate(template.body, {
        head_name: row.guest_groups!.head_name,
        hotel_name: row.rooms!.hotels?.name ?? '',
        room_number: rooms.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(' / '),
        check_in_time: row.check_in_time?.slice(0, 5) ?? 'check-in',
      }),
      status: 'queued' as const,
    }))

  if (messages.length === 0) return { ok: true, queued: 0 }

  const { data, error } = await supabase.from('messages').insert(messages).select('id')
  if (error) return { ok: false, error: friendlyDbError(error) }

  revalidateRooms(eventCode)
  return { ok: true, queued: data?.length ?? 0 }
}

function revalidateRooms(eventCode: string) {
  revalidatePath('/admin/rooms')
  revalidatePath('/admin/rooms/allocate')
  revalidatePath('/admin/hotels')
  revalidatePath(`/${eventCode}`)
}
