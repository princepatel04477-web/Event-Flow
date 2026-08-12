import { supabase } from '@/lib/supabase/client'
// Client module: reached from HotelListClient.tsx, so it must not pull in
// queries.ts ('server-only' → cookies()/redirect()). Same semantics, browser
// client — see queries-client.ts.
import { getEventAccessClient } from '@/lib/supabase/queries-client'

export interface HotelListItem {
  id: string
  name: string
  roomCount: number
  occupiedCount: number
  address: string | null
}

export async function readHotelList(eventId: string): Promise<HotelListItem[]> {
  const access = await getEventAccessClient(eventId)
  if (access !== 'admin' && access !== 'event_team') return []

  const { data: hotels } = await supabase
    .from('hotels')
    .select('id, name, address')
    .eq('event_id', eventId)
    .order('name')

  if (!hotels || hotels.length === 0) return []

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

  return hotels.map(h => ({
    id: h.id,
    name: h.name,
    address: h.address,
    roomCount: roomCountByHotel.get(h.id) ?? 0,
    occupiedCount: occupiedByHotel.get(h.id) ?? 0,
  }))
}
