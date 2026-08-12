import 'server-only'

import { createClient } from '@/lib/supabase/server'
import {
  allocateRooms,
  type AllocGroup,
  type AllocGuest,
  type AllocRoom,
  type AllocationPlan,
} from '@/lib/rooms/allocate'

/**
 * Everything the allocator needs, read in one place.
 *
 * The proposal screen and the commit both call this, so the plan a human
 * approves and the plan that gets written come from the same reads through
 * the same code. Anything else makes the confirmation meaningless.
 */

export interface LoadedAllocation {
  plan: AllocationPlan
  /** Confirmed groups that already have every guest in a room. */
  fullyPlaced: number
  /** Confirmed families with no guest rows at all — they cannot be allocated. */
  familiesWithoutGuests: { id: string; headName: string }[]
  error: string | null
}

export async function loadAllocationPlan(eventId: string): Promise<LoadedAllocation> {
  const supabase = await createClient()

  const [groupsRes, guestsRes, roomsRes, assignmentsRes] = await Promise.all([
    supabase
      .from('guest_groups')
      .select('id, head_name, group_type, side, priority, confirmed_pax')
      .eq('event_id', eventId)
      // Only confirmed families are allocated. Anyone still tentative or
      // unreachable would be holding a bed on a guess.
      .eq('rsvp_status', 'confirmed'),
    supabase
      .from('guests')
      .select('id, group_id, full_name, age_band, is_head')
      .eq('event_id', eventId),
    supabase
      .from('rooms')
      .select('id, hotel_id, room_number, capacity, is_blocked, hotels(name)')
      .eq('event_id', eventId),
    supabase
      .from('room_assignments')
      .select('guest_id, group_id, room_id')
      .eq('event_id', eventId)
      .is('released_at', null),
  ])

  const failure = [groupsRes, guestsRes, roomsRes, assignmentsRes].find((r) => r.error)
  if (failure?.error) {
    return {
      plan: emptyPlan(),
      fullyPlaced: 0,
      familiesWithoutGuests: [],
      error: failure.error.message,
    }
  }

  type RoomJoin = {
    id: string
    hotel_id: string
    room_number: string
    capacity: number
    is_blocked: boolean
    hotels: { name: string } | null
  }

  const activeByGuest = new Map<string, string>()
  const occupantsByRoom = new Map<string, { guestId: string; groupId: string }[]>()
  for (const a of assignmentsRes.data ?? []) {
    activeByGuest.set(a.guest_id, a.room_id)
    const list = occupantsByRoom.get(a.room_id) ?? []
    list.push({ guestId: a.guest_id, groupId: a.group_id })
    occupantsByRoom.set(a.room_id, list)
  }

  const guestsByGroup = new Map<string, AllocGuest[]>()
  const groupOfGuest = new Map<string, string>()
  for (const g of guestsRes.data ?? []) {
    groupOfGuest.set(g.id, g.group_id)
    const list = guestsByGroup.get(g.group_id) ?? []
    list.push({
      id: g.id,
      fullName: g.full_name,
      ageBand: g.age_band,
      isHead: g.is_head,
    })
    guestsByGroup.set(g.group_id, list)
  }
  // Head first, then alphabetical — a stable order, so the same inputs
  // produce the same proposal twice running.
  for (const list of guestsByGroup.values()) {
    list.sort((a, b) => Number(b.isHead) - Number(a.isHead) || a.fullName.localeCompare(b.fullName))
  }

  const roomRows = (roomsRes.data ?? []) as unknown as RoomJoin[]
  const roomById = new Map(roomRows.map((r) => [r.id, r]))

  const groups: AllocGroup[] = []
  const familiesWithoutGuests: { id: string; headName: string }[] = []
  let fullyPlaced = 0

  for (const group of groupsRes.data ?? []) {
    const all = guestsByGroup.get(group.id) ?? []
    if (all.length === 0) {
      familiesWithoutGuests.push({ id: group.id, headName: group.head_name })
      continue
    }

    const unplaced = all.filter((g) => !activeByGuest.has(g.id))
    const placed = all.filter((g) => activeByGuest.has(g.id))

    if (unplaced.length === 0) {
      fullyPlaced++
      continue
    }

    // A family never splits across hotels, so a re-run is pinned to wherever
    // the first placement put them.
    const existingRooms = placed
      .map((g) => roomById.get(activeByGuest.get(g.id)!))
      .filter((r): r is RoomJoin => Boolean(r))

    groups.push({
      id: group.id,
      headName: group.head_name,
      groupType: group.group_type,
      side: group.side,
      priority: group.priority,
      unplacedGuests: unplaced,
      placedCount: placed.length,
      pinnedHotelId: existingRooms[0]?.hotel_id ?? null,
      existingRoomNumbers: [...new Set(existingRooms.map((r) => r.room_number))],
    })
  }

  const rooms: AllocRoom[] = roomRows
    .filter((r) => !r.is_blocked)
    .map((r) => {
      const occupants = occupantsByRoom.get(r.id) ?? []
      return {
        id: r.id,
        hotelId: r.hotel_id,
        hotelName: r.hotels?.name ?? 'Unknown hotel',
        roomNumber: r.room_number,
        capacity: r.capacity,
        // Never negative: an overridden room can hold more than its capacity.
        freeBeds: Math.max(0, r.capacity - occupants.length),
        occupiedByOthers: occupants.length > 0,
      }
    })

  return {
    plan: allocateRooms(groups, rooms),
    fullyPlaced,
    familiesWithoutGuests,
    error: null,
  }
}

function emptyPlan(): AllocationPlan {
  return {
    placements: [],
    unplaced: [],
    shares: [],
    emptyRooms: [],
    summary: {
      familiesPlaced: 0,
      familiesUnplaced: 0,
      guestsPlaced: 0,
      bedsSpare: 0,
      roomsUsed: 0,
      roomsEmpty: 0,
    },
  }
}
