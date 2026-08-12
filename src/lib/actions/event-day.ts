'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { friendlyDbError } from '@/lib/errors'
import type { Database } from '@/lib/supabase/database.types'

type TravelLegRow = Database['public']['Tables']['travel_legs']['Row']
type RoomAssignmentRow = Database['public']['Tables']['room_assignments']['Row']

export type EventDayResult =
  | { ok: true; leg: TravelLegRow }
  | { ok: true; assignment: RoomAssignmentRow }
  | { ok: false; message: string }

/**
 * Map an RPC failure to a sentence a staff member can act on. The RPCs raise
 * specific codes; `friendlyDbError` would fold the no-room and occupied-room
 * cases into one generic "something went wrong". The actionable wording lives
 * here so the UI can show it (and, for no-room, link to allocation).
 */
function eventDayError(error: { message?: string | null; code?: string | null; details?: string | null } | null): string {
  if (!error) return 'Something went wrong. Try again in a moment.'
  if (error.code === '23503' || (error.message ?? '').toLowerCase().includes('no allocated room')) {
    return 'This family has no allocated room. Allocate a room first, then check them in.'
  }
  if (error.code === '55P03' || (error.message ?? '').toLowerCase().includes('occupied')) {
    return error.message ?? 'The room is occupied by another family — check them out first.'
  }
  if ((error.message ?? '').toLowerCase().includes('no arrival leg')) {
    return 'No arrival leg is on file for this family — add their travel details first.'
  }
  if ((error.message ?? '').toLowerCase().includes('no departure leg')) {
    return 'No departure leg is on file for this family — add their travel details first.'
  }
  if ((error.message ?? '').toLowerCase().includes('not checked in')) {
    return 'This family is not checked in, so there is nothing to check out.'
  }
  return friendlyDbError(error)
}

/**
 * Mark a family arrived / departed / checked in / out. Every one of these
 * runs as a security-definer RPC that stamps `now()` SERVER-side — the
 * browser clock is never trusted for an event-day timestamp. The actions are
 * thin wrappers that revalidate the affected screens.
 */

export async function markArrived(
  eventId: string,
  eventCode: string,
  groupId: string,
): Promise<EventDayResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('mark_arrived', {
    p_event_id: eventId,
    p_group_id: groupId,
  })

  if (error) {
    return { ok: false, message: eventDayError(error) }
  }

  revalidatePath(`/${eventCode}/logistics/arrivals`)
  revalidatePath(`/${eventCode}/logistics/departures`)
  return { ok: true, leg: data as TravelLegRow }
}

export async function markDeparted(
  eventId: string,
  eventCode: string,
  groupId: string,
): Promise<EventDayResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('mark_departed', {
    p_event_id: eventId,
    p_group_id: groupId,
  })

  if (error) {
    return { ok: false, message: eventDayError(error) }
  }

  revalidatePath(`/${eventCode}/logistics/departures`)
  return { ok: true, leg: data as TravelLegRow }
}

export async function checkInRoom(
  eventId: string,
  eventCode: string,
  groupId: string,
): Promise<EventDayResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('check_in_room', {
    p_event_id: eventId,
    p_group_id: groupId,
  })

  if (error) {
    return { ok: false, message: eventDayError(error) }
  }

  revalidatePath(`/${eventCode}/hospitality/rooms`)
  revalidatePath(`/${eventCode}/logistics/arrivals`)
  return { ok: true, assignment: data as RoomAssignmentRow }
}

export async function checkOutRoom(
  eventId: string,
  eventCode: string,
  groupId: string,
): Promise<EventDayResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('check_out_room', {
    p_event_id: eventId,
    p_group_id: groupId,
  })

  if (error) {
    return { ok: false, message: eventDayError(error) }
  }

  revalidatePath(`/${eventCode}/hospitality/rooms`)
  revalidatePath(`/${eventCode}/logistics/departures`)
  return { ok: true, assignment: data as RoomAssignmentRow }
}
