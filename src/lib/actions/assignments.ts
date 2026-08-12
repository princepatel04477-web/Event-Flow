'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { friendlyDbError } from '@/lib/errors'

/**
 * The manual override operations, used most on the day itself.
 *
 * Two rules run through all of them:
 *
 *  1. An assignment is NEVER hard-deleted. Releasing sets `released_at` and
 *     keeps the row, because the history is how a swap gets explained three
 *     days later.
 *  2. Over-capacity is possible but never accidental. `app.guard_room_capacity()`
 *     raises 23514, which is surfaced as a question; saying yes requires a
 *     typed reason that goes on the row.
 */

export type AssignmentResult =
  | { ok: true }
  /** The room is full. The caller may retry with `override`. */
  | { ok: false; needsOverride: true; roomNumber: string; error: string }
  | { ok: false; needsOverride?: false; error: string }

export interface Override {
  reason: string
}

function revalidateRooms(eventCode: string) {
  revalidatePath('/admin/rooms')
  revalidatePath('/admin/rooms/allocate')
  revalidatePath('/admin/hotels')
  revalidatePath(`/${eventCode}`)
}

/** 23514 is `app.guard_room_capacity()` refusing an over-capacity placement. */
function isCapacityRefusal(code: string | null | undefined): boolean {
  return code === '23514'
}

function checkOverride(override: Override | null): string | null {
  if (!override) return null
  const reason = override.reason.trim()
  // The reason IS the audit trail. A blank one, or a default we filled in
  // ourselves, would record nothing while looking like it recorded something.
  if (reason.length < 3) {
    return 'Type a reason for going over capacity — it is the only record of why.'
  }
  return null
}

/**
 * Put a guest into a room.
 *
 * Called both for a guest with no room and, after `releaseGuest`, as the
 * second half of a move.
 */
export async function assignGuest(
  eventId: string,
  eventCode: string,
  guestId: string,
  groupId: string,
  roomId: string,
  roomNumber: string,
  override: Override | null = null,
): Promise<AssignmentResult> {
  const invalid = checkOverride(override)
  if (invalid) return { ok: false, error: invalid }

  const supabase = await createClient()

  const { error } = await supabase.from('room_assignments').insert({
    event_id: eventId,
    room_id: roomId,
    guest_id: guestId,
    group_id: groupId,
    is_override: override !== null,
    override_reason: override?.reason.trim() ?? null,
  })

  if (error) {
    if (isCapacityRefusal(error.code) && !override) {
      return {
        ok: false,
        needsOverride: true,
        roomNumber,
        error: `Room ${roomNumber} is full.`,
      }
    }
    if (error.code === '23505') {
      return {
        ok: false,
        error: 'That guest already has a room. Release it first, or use Move.',
      }
    }
    return { ok: false, error: friendlyDbError(error) }
  }

  revalidateRooms(eventCode)
  return { ok: true }
}

/**
 * Release a guest from their current room.
 *
 * Sets `released_at`; the row stays. Scoped to the active assignment so a
 * stale page cannot reopen and re-close a historical one.
 */
export async function releaseGuest(
  eventId: string,
  eventCode: string,
  guestId: string,
  reason: string | null = null,
): Promise<AssignmentResult> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('room_assignments')
    .update({
      released_at: new Date().toISOString(),
      release_reason: reason?.trim() || null,
    })
    .eq('event_id', eventId)
    .eq('guest_id', guestId)
    .is('released_at', null)
    .select('id')

  if (error) return { ok: false, error: friendlyDbError(error) }
  if (!data || data.length === 0) {
    return { ok: false, error: 'That guest was not in a room — refresh and try again.' }
  }

  revalidateRooms(eventCode)
  return { ok: true }
}

/**
 * Move a guest from one room to another. Two taps on the screen; two
 * statements here.
 *
 * Release first, then assign — that order matters, because
 * `room_assignments_one_active_per_guest` forbids holding two active rooms,
 * so assigning first would always be refused.
 *
 * If the assign then fails (the target is full and no override was given),
 * the release is rolled back by re-assigning to the original room, so the
 * guest is never left in limbo. That restore is best-effort and says so if
 * it cannot be done.
 */
export async function moveGuest(
  eventId: string,
  eventCode: string,
  guestId: string,
  groupId: string,
  fromRoomId: string,
  toRoomId: string,
  toRoomNumber: string,
  override: Override | null = null,
): Promise<AssignmentResult> {
  if (fromRoomId === toRoomId) return { ok: true }

  const invalid = checkOverride(override)
  if (invalid) return { ok: false, error: invalid }

  const released = await releaseGuest(eventId, eventCode, guestId, 'Moved to another room')
  if (!released.ok) return released

  const assigned = await assignGuest(
    eventId,
    eventCode,
    guestId,
    groupId,
    toRoomId,
    toRoomNumber,
    override,
  )

  if (!assigned.ok) {
    const restore = await assignGuest(
      eventId,
      eventCode,
      guestId,
      groupId,
      fromRoomId,
      'previous room',
      // The original room held them a moment ago, so it has space. An
      // override is not needed and must not be invented.
      null,
    )
    if (!restore.ok) {
      return {
        ok: false,
        error:
          `${assigned.error} The guest could not be put back in their original room either — ` +
          `they are now unallocated. Assign them somewhere from the unplaced list.`,
      }
    }
    // Preserve the needsOverride signal so the screen can offer the override.
    return assigned
  }

  return { ok: true }
}
