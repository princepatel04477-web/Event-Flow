'use server'

import { createClient } from '@/lib/supabase/server'
import { getEventAccess } from '@/lib/supabase/queries'

export interface HotelListItem {
  id: string
  name: string
  roomCount: number
  occupiedCount: number
  address: string | null
}

export type HotelListResult =
  | { ok: true; hotels: HotelListItem[] }
  | { ok: false; error: string }

/**
 * Read the hotels for one event.
 *
 * EVERY FAILURE USED TO RETURN `[]`. A session without staff access, an RLS
 * refusal and a broken query all collapsed into an empty array, and the list
 * screen renders an empty array as "No hotels yet — add the first hotel".
 * That empty state asserts a fact about the event; what it actually meant was
 * "this request could not see them". A hotel that exists, that another session
 * can see, reads as a hotel that was never created — and the obvious next
 * action it offers is to create a duplicate.
 *
 * So failures are now distinguishable from emptiness. `{ ok: true, hotels: [] }`
 * is the only thing that means the event genuinely has no hotels.
 */
export async function readHotelList(eventId: string): Promise<HotelListResult> {
  const access = await getEventAccess(eventId)
  if (access !== 'admin' && access !== 'event_team') {
    return {
      ok: false,
      error:
        `This session has no staff access to this event (resolved: ${access}), so its ` +
        `hotels are hidden. They have not been deleted — sign in again, or check you are ` +
        `on the right event.`,
    }
  }

  const supabase = await createClient()

  const { data: hotels, error: hotelsError } = await supabase
    .from('hotels')
    .select('id, name, address')
    .eq('event_id', eventId)
    .order('name')

  if (hotelsError) {
    return { ok: false, error: `Could not read hotels: ${hotelsError.message}` }
  }
  if (!hotels || hotels.length === 0) return { ok: true, hotels: [] }

  const { data: roomCounts } = await supabase
    .from('rooms')
    .select('hotel_id, id')
    .eq('event_id', eventId)

  const { data: activeAssignments } = await supabase
    .from('room_assignments')
    .select('room_id')
    .eq('event_id', eventId)
    .is('released_at', null)

  const roomCountByHotel = new Map<string, number>()
  for (const r of roomCounts ?? []) {
    roomCountByHotel.set(r.hotel_id, (roomCountByHotel.get(r.hotel_id) ?? 0) + 1)
  }

  // Map room_id → hotel for occupancy counting
  const roomHotelMap = new Map<string, string>()
  for (const r of roomCounts ?? []) {
    roomHotelMap.set(r.id, r.hotel_id)
  }

  const occupiedByHotel = new Map<string, number>()
  for (const a of activeAssignments ?? []) {
    const hId = roomHotelMap.get(a.room_id)
    if (hId) occupiedByHotel.set(hId, (occupiedByHotel.get(hId) ?? 0) + 1)
  }

  return {
    ok: true,
    hotels: hotels.map(h => ({
      id: h.id,
      name: h.name,
      address: h.address,
      roomCount: roomCountByHotel.get(h.id) ?? 0,
      occupiedCount: occupiedByHotel.get(h.id) ?? 0,
    })),
  }
}
