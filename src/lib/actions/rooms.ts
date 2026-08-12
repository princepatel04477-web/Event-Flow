import { supabase } from '@/lib/supabase/client'
import { friendlyDbError } from '@/lib/errors'
import { suggestRooms } from '@/lib/allocate/suggest'

/** Per-phase timing for server actions (instrument-first). */
function phaseTiming(label: string) {
  const marks: Record<string, number> = {}
  let last = performance.now()
  return {
    mark(name: string) {
      const now = performance.now()
      marks[name] = Math.round(now - last)
      last = now
    },
    report() {
      const parts = Object.entries(marks).map(([k, v]) => `${k}:${v}ms`)
      console.log(`[perf] ${label} phases :: ${parts.join(' · ')}`)
    },
  }
}

type GroupRow = {
  id: string; head_name: string; group_type: string; side: string | null
  expected_pax: number; confirmed_pax: number | null; priority: number
}
type RoomRow = { id: string; hotel_id: string; room_number: string; capacity: number; max_capacity: number | null; floor: string | null }
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
  /** Extra-bed ceiling; falls back to capacity when null (pre-migration). */
  maxCapacity: number
  floor: string | null
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

  const [groupsRes, roomsRes, guestsRes] = await Promise.all([
    supabase
      .from('guest_groups')
      .select('id, head_name, group_type, side, expected_pax, confirmed_pax, priority')
      .eq('event_id', eventId)
      .eq('rsvp_status', 'confirmed')
      .order('priority', { ascending: false }),
    supabase
      .from('rooms')
      .select('id, hotel_id, room_number, capacity, max_capacity, floor')
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
    maxCapacity: r.max_capacity ?? r.capacity,
    floor: r.floor,
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
// R2: suggest top-3 rooms per unallocated family
// ---------------------------------------------------------------------------

export interface RoomSuggestionRow {
  groupId: string
  headName: string
  occupancy: number
  tooLarge: boolean
  tooLargeReason: string | null
  options: {
    roomId: string
    hotelName: string
    roomNumber: string
    floor: string | null
    fitsBase: boolean
    reason: string
  }[]
}

export interface SuggestRoomsResult {
  ok: boolean
  error: string | null
  suggestions: RoomSuggestionRow[]
}

/**
 * Run the suggest engine over every unallocated family and return top-3
 * candidates with plain-language reasons. Suggest-only: nothing is written.
 */
export async function suggestRoomAssignments(eventId: string): Promise<SuggestRoomsResult> {
  const data = await readAllocationData(eventId)

  // SuggestRoom shape the engine wants.
  const rooms = data.rooms.map((r) => ({
    id: r.id,
    hotelId: r.hotelId,
    hotelName: r.hotelName,
    roomNumber: r.roomNumber,
    floor: r.floor,
    baseCapacity: r.capacity,
    maxCapacity: r.maxCapacity,
    occupied: r.occupiedBeds,
  }))

  const rows: RoomSuggestionRow[] = []

  for (const group of data.groups) {
    // Skip families already holding a room.
    if (group.existingRoomIds.length > 0) continue

    const occupancy = group.confirmedPax ?? group.expectedPax
    const guests = data.guests
      .filter((g) => g.groupId === group.id)
      .map((g) => ({ fullName: g.isHead ? group.headName : '', ageBand: g.ageBand as 'adult' | 'child' | 'infant' }))

    const result = suggestRooms({
      id: group.id,
      headName: group.headName,
      side: group.side as 'bride' | 'groom' | 'both' | 'other' | null,
      occupancy,
      guests,
    }, rooms)

    rows.push({
      groupId: group.id,
      headName: group.headName,
      occupancy,
      tooLarge: result.tooLarge,
      tooLargeReason: result.tooLargeReason,
      options: result.suggestions.map((s) => ({
        roomId: s.room.id,
        hotelName: s.room.hotelName,
        roomNumber: s.room.roomNumber,
        floor: s.room.floor,
        fitsBase: s.fitsBase,
        reason: s.reason,
      })),
    })
  }

  return { ok: true, error: null, suggestions: rows }
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
  const timing = phaseTiming('rooms :: readRoomsGrid')
  timing.mark('client-create')

  // Sequential reads — deliberately NOT a Promise.all batch. The rooms grid
  // was flaky at 543-guest scale when five requests fired concurrently to
  // the Supabase region; sequential keeps each request individually short
  // and deterministic. The group read was merged (was: groups + confirmed
  // groups = 6 requests; now: 5) by selecting rsvp_status once.
  const roomsRes = await supabase
    .from('rooms')
    .select('id, hotel_id, room_number, capacity, is_blocked')
    .eq('event_id', eventId)
    .order('room_number', { ascending: true })
  const assignmentsRes = await supabase
    .from('room_assignments')
    .select('id, room_id, guest_id, group_id, is_override')
    .eq('event_id', eventId)
    .is('released_at', null)
  const hotelsRes = await supabase
    .from('hotels')
    .select('id, name')
    .eq('event_id', eventId)
  const guestsRes = await supabase
    .from('guests')
    .select('id, group_id, age_band, is_head')
    .eq('event_id', eventId)
  const groupsRes = await supabase
    .from('guest_groups')
    .select('id, head_name, rsvp_status')
    .eq('event_id', eventId)
  timing.mark('reads')

  const roomsRaw = roomsRes.data ?? []
  const assignments = assignmentsRes.data ?? []
  const hotelRows = hotelsRes.data ?? []
  const guestsAll = guestsRes.data ?? []
  const groupRows = groupsRes.data ?? []

  const hotelNames = new Map(hotelRows.map((h) => [h.id, h.name]))
  const groupNames = new Map(groupRows.map((g) => [g.id, g.head_name]))
  const confirmedGroupIds = new Set(
    groupRows.filter((g) => g.rsvp_status === 'confirmed').map((g) => g.id),
  )

  // Precompute lookup maps once, so the per-room assembly below is O(rooms +
  // assignments + guests) instead of O(rooms × assignments × guests). With
  // 238 groups and a room per family the nested form was a full re-scan on
  // every room card.
  const guestById = new Map(guestsAll.map((g) => [g.id, g]))
  const assignmentsByRoom = new Map<string, { id: string; room_id: string; guest_id: string; group_id: string; is_override: boolean }[]>()
  for (const a of assignments) {
    const list = assignmentsByRoom.get(a.room_id) ?? []
    list.push(a)
    assignmentsByRoom.set(a.room_id, list)
  }

  // Build guest name map: if is_head, use head_name from group
  const guestNames = new Map<string, string>()
  for (const g of guestsAll) {
    if (g.is_head) {
      guestNames.set(g.id, groupNames.get(g.group_id) ?? 'Guest')
    }
  }

  const assignedGuestIds = new Set(assignments.map((a) => a.guest_id))

  const rooms = roomsRaw.map((r) => {
    const occupants: RoomGridGuest[] = (assignmentsByRoom.get(r.id) ?? []).map((a) => {
      const guest = guestById.get(a.guest_id)
      return {
        guestId: a.guest_id,
        guestName: guestNames.get(a.guest_id) ?? 'Guest',
        groupId: a.group_id,
        headName: groupNames.get(a.group_id) ?? 'Unknown',
        ageBand: guest?.age_band ?? 'adult',
        isHead: guest?.is_head ?? false,
        assignmentId: a.id,
      }
    })

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

  // Unplaced: confirmed guests NOT in any active assignment. The confirmed
  // group ids come from the single group read in the batch above.
  const unplaced = guestsAll
    .filter((g) => !assignedGuestIds.has(g.id) && confirmedGroupIds.has(g.group_id))
    .map((g) => ({
      guestId: g.id,
      guestName: guestNames.get(g.id) ?? 'Guest',
      groupId: g.group_id,
      headName: groupNames.get(g.group_id) ?? 'Unknown',
    }))

  timing.mark('assemble')
  timing.report()
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

// ---------------------------------------------------------------------------
// R2: assign every unplaced guest of a family to one room (suggest confirm)
// ---------------------------------------------------------------------------

export type AssignGroupResult =
  | { ok: true; assigned: number }
  | { ok: false; error: string; code?: string; roomId?: string; roomNumber?: string }

/**
 * Assign all unplaced guests of a family to the chosen room — the confirm
 * path for the top-3 suggestion panel. The DB still enforces max_capacity
 * and date-range overlap; this action just submits the family as one unit so
 * a family is never split across rooms by the suggestion flow.
 */
export async function assignGroupToRoom(
  eventId: string,
  groupId: string,
  roomId: string,
): Promise<AssignGroupResult> {

  const { data: guests } = await supabase
    .from('guests')
    .select('id')
    .eq('event_id', eventId)
    .eq('group_id', groupId)

  const list = (guests ?? []) as unknown as { id: string }[]
  if (list.length === 0) {
    return { ok: false, error: 'This family has no guests to assign.', code: 'other' }
  }

  // Assign head first so the room shows the family name, then the rest.
  const { data: head } = await supabase
    .from('guests')
    .select('id')
    .eq('event_id', eventId)
    .eq('group_id', groupId)
    .eq('is_head', true)
    .maybeSingle()

  const ordered = head
    ? [head.id, ...list.filter((g) => g.id !== head.id).map((g) => g.id)]
    : list.map((g) => g.id)

  let assigned = 0
  for (const guestId of ordered) {
    const res = await assignGuestToRoom(eventId, guestId, roomId, null)
    if (!res.ok) {
      // Surface the first failure (capacity/overlap) — the family stays whole.
      const extra = res.code === 'capacity' && 'roomId' in res
        ? { code: res.code as 'capacity', roomId: res.roomId, roomNumber: res.roomNumber }
        : { code: res.code }
      return { ok: false, error: res.error, ...extra }
    }
    assigned++
  }

  return { ok: true, assigned }
}
