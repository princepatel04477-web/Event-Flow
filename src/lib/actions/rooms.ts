'use server'

import { createClient } from '@/lib/supabase/server'
import { friendlyDbError } from '@/lib/errors'

type GroupRow = {
  id: string; head_name: string; group_type: string; side: string | null
  expected_pax: number; confirmed_pax: number | null; priority: number
}
type RoomRow = { id: string; hotel_id: string; room_number: string; capacity: number }
type GuestRow = { id: string; group_id: string; age_band: string; is_head: boolean }
type HotelRow = { id: string; name: string }
type AssignmentRow = { room_id: string; group_id: string; guest_id: string }

// ---------------------------------------------------------------------------
// Read: allocation data for the allocator
// ---------------------------------------------------------------------------

export interface AllocationData {
  groups: AllocationGroup[]
  rooms: AllocationRoom[]
  guests: AllocationGuest[]
}

export interface AllocationGroup {
  id: string
  headName: string
  groupType: string
  side: string | null
  expectedPax: number
  confirmedPax: number | null
  priority: number
  guestIds: string[]
  existingRoomIds: string[]
}

export interface AllocationRoom {
  id: string
  hotelId: string
  hotelName: string
  roomNumber: string
  capacity: number
  occupiedBeds: number
  freeBeds: number
}

export interface AllocationGuest {
  id: string
  groupId: string
  ageBand: string
  isHead: boolean
}

export async function readAllocationData(eventId: string): Promise<AllocationData> {
  const supabase = await createClient()

  const [groupsRes, roomsRes, guestsRes] = await Promise.all([
    supabase
      .from('guest_groups')
      .select('id, head_name, group_type, side, expected_pax, confirmed_pax, priority')
      .eq('event_id', eventId)
      .eq('rsvp_status', 'confirmed')
      .order('priority', { ascending: false }),
    supabase
      .from('rooms')
      .select('id, hotel_id, room_number, capacity')
      .eq('event_id', eventId)
      .eq('is_blocked', false)
      .order('room_number', { ascending: true }),
    supabase
      .from('guests')
      .select('id, group_id, age_band, is_head')
      .eq('event_id', eventId),
  ])

  const groups = (groupsRes.data ?? []) as unknown as GroupRow[]
  const roomsRaw = (roomsRes.data ?? []) as unknown as RoomRow[]
  const guestsAll = (guestsRes.data ?? []) as unknown as GuestRow[]

  // Fetch hotels separately (need names)
  const hotelIds = [...new Set(roomsRaw.map((r) => r.hotel_id))]
  const hotels = new Map<string, string>()
  if (hotelIds.length > 0) {
    const { data: hotelRows } = await supabase
      .from('hotels')
      .select('id, name')
      .in('id', hotelIds)
    for (const h of ((hotelRows ?? []) as unknown as HotelRow[])) {
      hotels.set(h.id, h.name)
    }
  }

  // Count existing active assignments per room
  const { data: assignments } = await supabase
    .from('room_assignments')
    .select('room_id, group_id, guest_id')
    .eq('event_id', eventId)
    .is('released_at', null)

  const occupancy = new Map<string, number>()
  const groupRoomMap = new Map<string, string[]>()
  for (const a of ((assignments ?? []) as unknown as AssignmentRow[])) {
    occupancy.set(a.room_id, (occupancy.get(a.room_id) ?? 0) + 1)
    const existing = groupRoomMap.get(a.group_id) ?? []
    existing.push(a.room_id)
    groupRoomMap.set(a.group_id, existing)
  }

  const rooms: AllocationRoom[] = roomsRaw.map((r) => ({
    id: r.id,
    hotelId: r.hotel_id,
    hotelName: hotels.get(r.hotel_id) ?? 'Unknown hotel',
    roomNumber: r.room_number,
    capacity: r.capacity,
    occupiedBeds: occupancy.get(r.id) ?? 0,
    freeBeds: r.capacity - (occupancy.get(r.id) ?? 0),
  }))

  return {
    groups: groups.map((g): AllocationGroup => ({
      id: g.id,
      headName: g.head_name,
      groupType: g.group_type,
      side: g.side,
      expectedPax: g.expected_pax,
      confirmedPax: g.confirmed_pax,
      priority: g.priority,
      guestIds: guestsAll.filter((r) => r.group_id === g.id).map((r) => r.id),
      existingRoomIds: groupRoomMap.get(g.id) ?? [],
    })),
    rooms,
    guests: guestsAll.map((g): AllocationGuest => ({
      id: g.id,
      groupId: g.group_id,
      ageBand: g.age_band,
      isHead: g.is_head,
    })),
  }
}

// ---------------------------------------------------------------------------
// Read: rooms grid for the manual override screen
// ---------------------------------------------------------------------------

export interface RoomGridGuest {
  guestId: string
  guestName: string
  groupId: string
  headName: string
  ageBand: string
  isHead: boolean
  assignmentId: string
}

export interface RoomGridRow {
  roomId: string
  hotelId: string
  hotelName: string
  roomNumber: string
  capacity: number
  isBlocked: boolean
  occupants: RoomGridGuest[]
  freeBeds: number
  isOverCapacity: boolean
}

export interface RoomsGridData {
  rooms: RoomGridRow[]
  /** Guests not currently assigned to any room. */
  unplaced: { guestId: string; guestName: string; groupId: string; headName: string }[]
}

export async function readRoomsGrid(eventId: string): Promise<RoomsGridData> {
  const supabase = await createClient()

  const [roomsRes, assignmentsRes, hotelsRes, guestsRes] = await Promise.all([
    supabase
      .from('rooms')
      .select('id, hotel_id, room_number, capacity, is_blocked')
      .eq('event_id', eventId)
      .order('room_number', { ascending: true }),
    supabase
      .from('room_assignments')
      .select('id, room_id, guest_id, group_id, is_override')
      .eq('event_id', eventId)
      .is('released_at', null),
    supabase
      .from('hotels')
      .select('id, name')
      .eq('event_id', eventId),
    supabase
      .from('guests')
      .select('id, group_id, age_band, is_head')
      .eq('event_id', eventId),
  ])

  const roomsRaw = roomsRes.data ?? []
  const assignments = assignmentsRes.data ?? []
  const hotelRows = hotelsRes.data ?? []
  const guestsAll = guestsRes.data ?? []

  const hotelNames = new Map(hotelRows.map((h) => [h.id, h.name]))

  // Resolve guest names from groups
  const { data: groups } = await supabase
    .from('guest_groups')
    .select('id, head_name')
    .eq('event_id', eventId)
  const groupNames = new Map((groups ?? []).map((g) => [g.id, g.head_name]))

  // Build guest name map: if is_head, use head_name from group
  const guestNames = new Map<string, string>()
  for (const g of guestsAll) {
    if (g.is_head) {
      guestNames.set(g.id, groupNames.get(g.group_id) ?? 'Guest')
    }
  }

  const assignedGuestIds = new Set(assignments.map((a) => a.guest_id))

  const rooms = roomsRaw.map((r) => {
    const occupants: RoomGridGuest[] = assignments
      .filter((a) => a.room_id === r.id)
      .map((a) => ({
        guestId: a.guest_id,
        guestName: guestNames.get(a.guest_id) ?? 'Guest',
        groupId: a.group_id,
        headName: groupNames.get(a.group_id) ?? 'Unknown',
        ageBand: guestsAll.find((g) => g.id === a.guest_id)?.age_band ?? 'adult',
        isHead: guestsAll.find((g) => g.id === a.guest_id)?.is_head ?? false,
        assignmentId: a.id,
      }))

    const occupied = occupants.length
    return {
      roomId: r.id,
      hotelId: r.hotel_id,
      hotelName: hotelNames.get(r.hotel_id) ?? 'Unknown hotel',
      roomNumber: r.room_number,
      capacity: r.capacity,
      isBlocked: r.is_blocked,
      occupants,
      freeBeds: Math.max(0, r.capacity - occupied),
      isOverCapacity: occupied > r.capacity,
    }
  })

  // Unplaced: confirmed guests NOT in any active assignment
  const { data: confirmedGroups } = await supabase
    .from('guest_groups')
    .select('id')
    .eq('event_id', eventId)
    .eq('rsvp_status', 'confirmed')

  const confirmedGroupIds = new Set((confirmedGroups ?? []).map((g) => g.id))

  const unplaced = guestsAll
    .filter((g) => !assignedGuestIds.has(g.id) && confirmedGroupIds.has(g.group_id))
    .map((g) => ({
      guestId: g.id,
      guestName: guestNames.get(g.id) ?? 'Guest',
      groupId: g.group_id,
      headName: groupNames.get(g.group_id) ?? 'Unknown',
    }))

  return { rooms, unplaced }
}

// ---------------------------------------------------------------------------
// Write: commit allocations atomically
// ---------------------------------------------------------------------------

export interface AllocationCommit {
  /** guest_id → room_id */
  assignments: Record<string, string>
  /** Whether to override capacity for each room being overfilled. */
  overrides: Record<string, string> // room_id → reason
}

export type CommitResult =
  | { ok: true; count: number }
  | { ok: false; error: string }

export async function commitAllocations(
  eventId: string,
  plan: AllocationCommit,
): Promise<CommitResult> {
  const supabase = await createClient()

  // We need group_id for each guest — resolve from the database
  const guestIds = Object.keys(plan.assignments)
  const { data: guestRows } = await supabase
    .from('guests')
    .select('id, group_id')
    .in('id', guestIds)
    .eq('event_id', eventId)

  const groupMap = new Map<string, string>()
  for (const g of (guestRows ?? [])) {
    groupMap.set(g.id, g.group_id)
  }

  const rows = Object.entries(plan.assignments).map(([guestId, roomId]) => {
    const overrideReason = plan.overrides[roomId] ?? null
    return {
      event_id: eventId,
      room_id: roomId,
      guest_id: guestId,
      group_id: groupMap.get(guestId) ?? '',
      is_override: !!overrideReason,
      override_reason: overrideReason || null,
    }
  })

  if (rows.length === 0) {
    return { ok: false, error: 'No assignments to commit.' }
  }

  const { error } = await supabase.from('room_assignments').insert(rows)

  if (error) {
    if (error.code === '23514') {
      return {
        ok: false,
        error:
          'Over capacity: one or more rooms would be overfilled. ' +
          'Supply an override reason for those rooms and try again.',
      }
    }
    return { ok: false, error: friendlyDbError(error) }
  }

  return { ok: true, count: rows.length }
}

// ---------------------------------------------------------------------------
// Write: move a guest between rooms
// ---------------------------------------------------------------------------

export type MoveGuestResult =
  | { ok: true }
  | { ok: false; error: string; code: 'capacity' | 'other' }
  | { ok: false; error: string; code: 'capacity'; roomId: string; roomNumber: string }

export async function moveGuestToRoom(
  assignmentId: string,
  targetRoomId: string,
  overrideReason: string | null,
): Promise<MoveGuestResult> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('room_assignments')
    .update({
      room_id: targetRoomId,
      is_override: !!overrideReason,
      override_reason: overrideReason || null,
    })
    .eq('id', assignmentId)

  if (error) {
    if (error.code === '23514' || error.message?.includes('capacity')) {
      // Need the room number for the UI
      const { data: room } = await supabase
        .from('rooms')
        .select('room_number')
        .eq('id', targetRoomId)
        .maybeSingle()

      return {
        ok: false,
        error: `Room ${room?.room_number ?? targetRoomId} is full. Add anyway?`,
        code: 'capacity',
        roomId: targetRoomId,
        roomNumber: room?.room_number ?? '',
      }
    }
    return { ok: false, error: friendlyDbError(error), code: 'other' }
  }

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Write: release a guest from a room
// ---------------------------------------------------------------------------

export type ReleaseGuestResult =
  | { ok: true }
  | { ok: false; error: string }

export async function releaseGuestFromRoom(
  assignmentId: string,
  reason: string,
): Promise<ReleaseGuestResult> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('room_assignments')
    .update({
      released_at: new Date().toISOString(),
      release_reason: reason,
    })
    .eq('id', assignmentId)

  if (error) {
    return { ok: false, error: friendlyDbError(error) }
  }

  return { ok: true }
}

// ---------------------------------------------------------------------------
// Write: assign an unplaced guest to a room
// ---------------------------------------------------------------------------

export type AssignGuestResult = MoveGuestResult

export async function assignGuestToRoom(
  eventId: string,
  guestId: string,
  roomId: string,
  overrideReason: string | null,
): Promise<AssignGuestResult> {
  const supabase = await createClient()

  // Resolve group_id from the guest
  const { data: guest } = await supabase
    .from('guests')
    .select('group_id')
    .eq('id', guestId)
    .maybeSingle()

  if (!guest) {
    return { ok: false, error: 'Guest not found.', code: 'other' }
  }

  const { error } = await supabase
    .from('room_assignments')
    .insert({
      event_id: eventId,
      room_id: roomId,
      guest_id: guestId,
      group_id: guest.group_id,
      is_override: !!overrideReason,
      override_reason: overrideReason || null,
    })

  if (error) {
    if (error.code === '23514' || error.message?.includes('capacity')) {
      const { data: room } = await supabase
        .from('rooms')
        .select('room_number')
        .eq('id', roomId)
        .maybeSingle()

      return {
        ok: false,
        error: `Room ${room?.room_number ?? roomId} is full. Add anyway?`,
        code: 'capacity',
        roomId,
        roomNumber: room?.room_number ?? '',
      }
    }
    return { ok: false, error: friendlyDbError(error), code: 'other' }
  }

  return { ok: true }
}
