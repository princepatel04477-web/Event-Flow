'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { friendlyDbError } from '@/lib/errors'
import { loadBackfillPlan } from '@/lib/rooms/load'
import { normalizeRoomNumber } from '@/lib/rooms/parse'

export type BackfillResult =
  | {
      ok: true
      roomsCreated: number
      guestsAssigned: number
      familiesTouched: number
      problems: number
      skippedByDatabase: number
    }
  | { ok: false; error: string }

/**
 * Apply the recovered room allocations.
 *
 * The plan is recomputed here from the database rather than accepted from the
 * client. The preview the user approved is a rendering of this same
 * computation; trusting a posted plan would let a stale page assign guests to
 * rooms that were renumbered or released in between.
 *
 * Idempotent: the planner counts a guest already actively assigned to the
 * room the sheet names as `alreadyAssigned` and plans no insert, so a second
 * run writes nothing.
 */
export async function applyBackfill(
  eventId: string,
  eventCode: string,
  hotelId: string,
  defaultCapacity: number,
): Promise<BackfillResult> {
  const loaded = await loadBackfillPlan(eventId, hotelId, defaultCapacity)
  if (loaded.error) return { ok: false, error: loaded.error }

  const { plan } = loaded
  if (plan.families.length === 0 && plan.roomsToCreate.length === 0) {
    return {
      ok: true,
      roomsCreated: 0,
      guestsAssigned: 0,
      familiesTouched: 0,
      problems: plan.problems.length,
      skippedByDatabase: 0,
    }
  }

  const supabase = await createClient()

  // 1. Create the rooms the sheet names that do not exist yet.
  let roomsCreated = 0
  if (plan.roomsToCreate.length > 0) {
    const { data, error } = await supabase
      .from('rooms')
      .upsert(
        plan.roomsToCreate.map((r) => ({
          event_id: eventId,
          hotel_id: hotelId,
          room_number: r.roomNumber,
          capacity: r.capacity,
          room_type: null,
          floor: null,
        })),
        { onConflict: 'hotel_id,room_number', ignoreDuplicates: true },
      )
      .select('id')

    if (error) return { ok: false, error: friendlyDbError(error) }
    roomsCreated = data?.length ?? 0
  }

  // 2. Re-read room ids, including the ones just created.
  const { data: rooms, error: roomsError } = await supabase
    .from('rooms')
    .select('id, room_number')
    .eq('hotel_id', hotelId)
    .eq('event_id', eventId)

  if (roomsError) return { ok: false, error: friendlyDbError(roomsError) }

  const roomIdByNumber = new Map(
    (rooms ?? []).map((r) => [normalizeRoomNumber(r.room_number), r.id]),
  )

  // 3. Build the assignment rows.
  const assignments: {
    event_id: string
    room_id: string
    guest_id: string
    group_id: string
  }[] = []

  for (const family of plan.families) {
    for (const a of family.assignments) {
      const roomId = roomIdByNumber.get(normalizeRoomNumber(a.roomNumber))
      // A room we planned but cannot now resolve means someone changed the
      // hotel underneath us. Refuse the whole run rather than allocate a
      // partial family.
      if (!roomId) {
        return {
          ok: false,
          error: `Room ${a.roomNumber} could not be found after creation. Nothing was assigned — reload and try again.`,
        }
      }
      assignments.push({
        event_id: eventId,
        room_id: roomId,
        guest_id: a.guestId,
        group_id: family.groupId,
      })
    }
  }

  if (assignments.length === 0) {
    revalidateBackfill(eventCode, hotelId)
    return {
      ok: true,
      roomsCreated,
      guestsAssigned: 0,
      familiesTouched: 0,
      problems: plan.problems.length,
      skippedByDatabase: 0,
    }
  }

  // 4. Insert.
  //
  //    A plain INSERT, not an upsert: `room_assignments_one_active_per_guest`
  //    is a PARTIAL unique index (`where released_at is null`), and PostgREST's
  //    `onConflict` cannot carry that predicate — Postgres answers
  //    "no unique or exclusion constraint matching the ON CONFLICT
  //    specification" and nothing is written.
  //
  //    The planner has already excluded every guest holding an active
  //    allocation, so a 23505 here means one was created between the preview
  //    and now. That aborts the whole statement, which is the safe outcome:
  //    re-running is free, because this operation is idempotent.
  const { data: inserted, error } = await supabase
    .from('room_assignments')
    .insert(assignments)
    .select('id')

  if (error) {
    if (error.code === '23505') {
      return {
        ok: false,
        error:
          'Somebody was allocated a room while you were looking at this preview, so nothing ' +
          'was written. Reload and run it again — already-allocated guests are skipped.',
      }
    }
    // 23514 is `app.guard_room_capacity()`. It means the plan's arithmetic
    // and the database's disagree — say so plainly instead of "check
    // constraint violated".
    if (error.code === '23514') {
      return {
        ok: false,
        error:
          'The database refused an allocation for exceeding a room capacity. ' +
          'Nothing was assigned. Raise the room capacity, or fix the sheet, then run this again.',
      }
    }
    return { ok: false, error: friendlyDbError(error) }
  }

  const guestsAssigned = inserted?.length ?? 0

  revalidateBackfill(eventCode, hotelId)

  return {
    ok: true,
    roomsCreated,
    guestsAssigned,
    familiesTouched: plan.families.length,
    problems: plan.problems.length,
    skippedByDatabase: assignments.length - guestsAssigned,
  }
}

function revalidateBackfill(eventCode: string, hotelId: string) {
  revalidatePath('/admin/hotels')
  revalidatePath('/admin/hotels/backfill')
  revalidatePath(`/admin/hotels/${hotelId}/rooms`)
  revalidatePath(`/${eventCode}`)
}
