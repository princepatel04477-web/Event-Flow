'use server'

import { createClient } from '@/lib/supabase/server'
import {
  friendlyDbError,
  roomGuardCause,
  roomGuardMessage,
  type RoomGuardCause,
} from '@/lib/errors'
import {
  allocate,
  type GroupForAllocation,
  type GuestType,
  type RoomForAllocation,
} from '@/lib/allocate/allocator'
import { suggestRooms } from '@/lib/allocate/suggest'

/** Per-phase timing for server actions (instrument-first). */
function phaseTiming() {
  const marks: Record<string, number> = {}
  let last = performance.now()
  return {
    mark(name: string) {
      const now = performance.now()
      marks[name] = Math.round(now - last)
      last = now
    },
    report() {
      // Intentionally silent in production/app flows to respect house rules (no console.log)
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
  /**
   * Set when a read FAILED. Empty arrays plus no message is the bug M15 names:
   * `planRoomAllocation` then answers "No rooms have been added to this event
   * yet." with an "Add rooms" button, on an event holding 168 of them — a
   * confident lie that invites duplicate data entry. An error field is additive,
   * so no caller's existing shape changes; the ones on the screen path check it.
   */
  error?: string
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
      .select('id, hotel_id, room_number, capacity, max_capacity, floor')
      .eq('event_id', eventId)
      .eq('is_blocked', false)
      .order('room_number', { ascending: true }),
    supabase
      .from('guests')
      .select('id, group_id, age_band, is_head')
      .eq('event_id', eventId),
  ])

  const readError = groupsRes.error ?? roomsRes.error ?? guestsRes.error

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
    ...(readError ? { error: readError.message } : {}),
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

  // A FAILED READ IS NOT "EVERYONE IS PLACED" (M15). With the error discarded,
  // a failed read produced no rooms and no unplaced families, and the v1 panel
  // rendered "Every confirmed family already has a room." — the most reassuring
  // possible sentence to put in front of someone deciding whether the event is
  // ready.
  if (data.error) {
    return { ok: false, error: `Could not read the rooms. ${data.error}`, suggestions: [] }
  }

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
// Read: under-bedded families (Phase 3 — placed but below headcount)
// ---------------------------------------------------------------------------

export interface UnderBeddedFamily {
  groupId: string
  headName: string
  headcount: number
  /** Number of guest rows materialized for this family. */
  memberRows: number
  /** Number of active (unreleased) room assignments this family holds. */
  placed: number
  /** headcount - placed. Positive means the family still needs beds. */
  shortfall: number
  /** True when member rows are fewer than headcount — a top-up is needed. */
  needsTopUp: boolean
  /** The family's type and side. The waiting rows label both. */
  groupType?: string
  side?: string | null
}

export interface UnderBeddedResult {
  ok: boolean
  error: string | null
  families: UnderBeddedFamily[]
}

/**
 * List every confirmed family that is placed but UNDER its headcount —
 * the gap ensureGroupMembers cannot heal by itself, because both suggest and
 * allocate skip families already holding a room (see suggestRoomAssignments).
 * A family imported with one head row, assigned one bed of six, then marked
 * placed would otherwise never surface its five missing beds.
 *
 * Read-only. It REPORTS the shortfall; the UI tops up via ensureGroupMembers /
 * assignGuestToRoom, which are already idempotent and head-count-aware.
 */
export async function readUnderBeddedFamilies(eventId: string): Promise<UnderBeddedResult> {
  const supabase = await createClient()

  const [groupsRes, guestsRes, assignmentsRes] = await Promise.all([
    supabase
      .from('guest_groups')
      .select('id, head_name, expected_pax, confirmed_pax')
      .eq('event_id', eventId)
      .eq('rsvp_status', 'confirmed'),
    supabase
      .from('guests')
      .select('id, group_id')
      .eq('event_id', eventId),
    supabase
      .from('room_assignments')
      .select('group_id')
      .eq('event_id', eventId)
      .is('released_at', null),
  ])

  if (groupsRes.error) return { ok: false, error: friendlyDbError(groupsRes.error), families: [] }
  if (guestsRes.error) return { ok: false, error: friendlyDbError(guestsRes.error), families: [] }
  if (assignmentsRes.error) return { ok: false, error: friendlyDbError(assignmentsRes.error), families: [] }

  const rowsByGroup = new Map<string, number>()
  for (const g of (guestsRes.data ?? []) as { group_id: string }[]) {
    rowsByGroup.set(g.group_id, (rowsByGroup.get(g.group_id) ?? 0) + 1)
  }
  const placedByGroup = new Map<string, number>()
  for (const a of (assignmentsRes.data ?? []) as { group_id: string }[]) {
    placedByGroup.set(a.group_id, (placedByGroup.get(a.group_id) ?? 0) + 1)
  }

  const families: UnderBeddedFamily[] = []
  for (const g of (groupsRes.data ?? []) as {
    id: string
    head_name: string
    expected_pax: number
    confirmed_pax: number | null
  }[]) {
    const headcount = g.confirmed_pax ?? g.expected_pax
    if (!headcount || headcount <= 0) continue
    const memberRows = rowsByGroup.get(g.id) ?? 0
    const placed = placedByGroup.get(g.id) ?? 0
    if (placed >= headcount) continue
    families.push({
      groupId: g.id,
      headName: g.head_name,
      headcount,
      memberRows,
      placed,
      shortfall: headcount - placed,
      needsTopUp: memberRows < headcount,
    })
  }

  return { ok: true, error: null, families }
}

// ---------------------------------------------------------------------------
// Read: rooms grid for the manual override screen
// ---------------------------------------------------------------------------

export interface RoomGridGuest {
  guestId: string
  guestName: string
  groupId: string
  headName: string
  /** The family head's mobile — shown on the room tap panel (§5.3). */
  primaryMobile: string | null
  /** True when the group's hamper is delivered (§5.3/§5.4). */
  hamperDelivered: boolean
  ageBand: string
  isHead: boolean
  assignmentId: string
  /** The family's type, so the room sheet knows who may be offered a share. */
  groupType: string
  side: string | null
}

export interface RoomGridRow {
  roomId: string
  hotelId: string
  hotelName: string
  roomNumber: string
  capacity: number
  /** Extra-bed ceiling. Shown nowhere; the board plans against `capacity`. */
  maxCapacity: number
  /** Floor label as the hotel writes it. Groups the Rooms tab. */
  floor: string | null
  isBlocked: boolean
  occupants: RoomGridGuest[]
  freeBeds: number
  isOverCapacity: boolean
}

/** One line of state-of-the-world for the top of the Rooms board. */
export interface RoomsBoardTotals {
  /** Confirmed headcount across the event (confirmed_pax ?? expected_pax). */
  confirmedGuests: number
  /** Confirmed guests who hold an active bed right now. */
  guestsWithBed: number
  /** Free beds in rooms that are not out of service. */
  bedsFree: number
  /** Confirmed families still short of at least one bed. */
  familiesWaiting: number
}

export interface RoomsGridData {
  rooms: RoomGridRow[]
  /** Guests not currently assigned to any room. */
  unplaced: {
    guestId: string
    guestName: string
    groupId: string
    headName: string
    /** The family's type and side — the room sheet's share rule needs both. */
    groupType: string
    side: string | null
  }[]
  /** Confirmed families placed but below their headcount (Phase 3). */
  underBedded: UnderBeddedFamily[]
  /** The board's header line, counted server-side from the same read. */
  totals: RoomsBoardTotals
  /**
   * Set when ONE OF THE FIVE READS FAILED (M15).
   *
   * Every read's `error` used to be discarded, so a transport failure, an RLS
   * refusal or a timeout produced `{ rooms: [], unplaced: [], … }` and the board
   * said "No rooms on this event yet" with an "Add rooms" button — on an event
   * that has 168 rooms. `totals` is derived from the same empty arrays, so the
   * header agreed with the lie. Additive field, checked by the screens.
   */
  error?: string
}

export async function readRoomsGrid(eventId: string): Promise<RoomsGridData> {
  const timing = phaseTiming()
  const supabase = await createClient()
  timing.mark('client-create')

  // Sequential reads — deliberately NOT a Promise.all batch. The rooms grid
  // was flaky at 543-guest scale when five requests fired concurrently to
  // the Supabase region; sequential keeps each request individually short
  // and deterministic. The group read was merged (was: groups + confirmed
  // groups = 6 requests; now: 5) by selecting rsvp_status once.
  const roomsRes = await supabase
    .from('rooms')
    .select('id, hotel_id, room_number, capacity, max_capacity, floor, is_blocked')
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
    .select('id, head_name, primary_mobile, rsvp_status, expected_pax, confirmed_pax, group_type, side')
    .eq('event_id', eventId)
  // Hamper delivered state per group, for the room-tap panel (§5.3) and the
  // per-room hamper coding (§5.4). Group-level hamper: kind=hamper, guest_id
  // null (the house model — one hamper per family, not per room).
  const hampersRes = await supabase
    .from('deliverables')
    .select('group_id, status')
    .eq('event_id', eventId)
    .eq('kind', 'hamper')
    .is('guest_id', null)
  timing.mark('reads')

  // EVERY READ'S ERROR IS CHECKED (M15). Five reads, five chances to hand the
  // board an empty event. A partial failure (rooms answered, guests did not) is
  // worse than a total one, because the board then renders real rooms with every
  // occupant missing. So any error at all means "do not render the board".
  const readError =
    roomsRes.error ??
    assignmentsRes.error ??
    hotelsRes.error ??
    guestsRes.error ??
    groupsRes.error ??
    hampersRes.error

  if (readError) {
    return {
      rooms: [],
      unplaced: [],
      underBedded: [],
      totals: {
        confirmedGuests: 0,
        guestsWithBed: 0,
        bedsFree: 0,
        familiesWaiting: 0,
      },
      error: readError.message,
    }
  }

  const roomsRaw = roomsRes.data ?? []
  const assignments = assignmentsRes.data ?? []
  const hotelRows = hotelsRes.data ?? []
  const guestsAll = guestsRes.data ?? []
  const groupRows = groupsRes.data ?? []
  const hamperRows = hampersRes.data ?? []

  const hotelNames = new Map(hotelRows.map((h) => [h.id, h.name]))
  const groupNames = new Map(groupRows.map((g) => [g.id, g.head_name]))
  const groupMobiles = new Map(groupRows.map((g) => [g.id, g.primary_mobile]))
  const groupTypes = new Map(groupRows.map((g) => [g.id, g.group_type as string]))
  const groupSides = new Map(groupRows.map((g) => [g.id, g.side as string | null]))
  const hamperDeliveredByGroup = new Map(
    (hamperRows ?? []).filter((d) => d.status === 'delivered').map((d) => [d.group_id, true]),
  )
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
        primaryMobile: groupMobiles.get(a.group_id) ?? null,
        hamperDelivered: hamperDeliveredByGroup.has(a.group_id),
        ageBand: guest?.age_band ?? 'adult',
        isHead: guest?.is_head ?? false,
        assignmentId: a.id,
        groupType: groupTypes.get(a.group_id) ?? 'family',
        side: groupSides.get(a.group_id) ?? null,
      }
    })

    const occupied = occupants.length
    return {
      roomId: r.id,
      hotelId: r.hotel_id,
      hotelName: hotelNames.get(r.hotel_id) ?? 'Unknown hotel',
      roomNumber: r.room_number,
      capacity: r.capacity,
      maxCapacity: r.max_capacity ?? r.capacity,
      floor: r.floor,
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
      groupType: groupTypes.get(g.group_id) ?? 'family',
      side: groupSides.get(g.group_id) ?? null,
    }))

  // Under-bedded: confirmed families placed but below their headcount.
  // This is the Phase 3 surface — families the suggest/allocate paths skip
  // (they already hold a room) but which still have unclaimed beds.
  const assignedByGroup = new Map<string, number>()
  for (const a of assignments) {
    assignedByGroup.set(a.group_id, (assignedByGroup.get(a.group_id) ?? 0) + 1)
  }
  const memberRowsByGroup = new Map<string, number>()
  for (const g of guestsAll) {
    memberRowsByGroup.set(g.group_id, (memberRowsByGroup.get(g.group_id) ?? 0) + 1)
  }
  const underBedded: UnderBeddedFamily[] = []
  for (const g of groupRows) {
    if (g.rsvp_status !== 'confirmed') continue
    const headcount = g.confirmed_pax ?? g.expected_pax
    if (!headcount || headcount <= 0) continue
    const placed = assignedByGroup.get(g.id) ?? 0
    if (placed >= headcount) continue
    const memberRows = memberRowsByGroup.get(g.id) ?? 0
    underBedded.push({
      groupId: g.id,
      headName: g.head_name,
      headcount,
      memberRows,
      placed,
      shortfall: headcount - placed,
      needsTopUp: memberRows < headcount,
      groupType: g.group_type as string,
      side: g.side as string | null,
    })
  }

  // The board's header line. Counted here, from the rows already in hand,
  // rather than re-read: a second query would be a second round trip to Seoul
  // for four numbers that are a reduce over data this function already holds.
  let confirmedGuests = 0
  for (const g of groupRows) {
    if (g.rsvp_status !== 'confirmed') continue
    const headcount = g.confirmed_pax ?? g.expected_pax
    if (!headcount || headcount <= 0) continue
    confirmedGuests += headcount
  }
  const totals: RoomsBoardTotals = {
    confirmedGuests,
    // Beds held by confirmed families. An assignment belonging to a family
    // that later declined is not a guest with a bed.
    guestsWithBed: assignments.filter((a) => confirmedGroupIds.has(a.group_id)).length,
    bedsFree: rooms.filter((r) => !r.isBlocked).reduce((n, r) => n + r.freeBeds, 0),
    familiesWaiting: underBedded.length,
  }

  timing.mark('assemble')
  timing.report()
  return { rooms, unplaced, underBedded, totals }
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
// Write: materialise a family's member rows
// ---------------------------------------------------------------------------

export interface EnsureMembersResult {
  /** guest ids for the group, head first, after any top-up. */
  guestIds: string[]
  /** How many rows this call had to create. */
  created: number
}

/**
 * Give a family as many `guests` rows as it has people.
 *
 * THE BUG THIS EXISTS TO FIX. The Excel import creates ONE `guests` row per
 * family — the head (CLAUDE.md §12) — while the headcount lives on
 * `guest_groups.confirmed_pax` / `expected_pax`. Rooms are assigned per
 * GUEST ROW (`room_assignments.guest_id`, one active row per guest). So a
 * family of six had exactly one assignable person: the planner sized a room
 * for six, the commit placed the head, and the other five silently went
 * nowhere. No error — the screen reported success and the room showed 1 of 6
 * beds taken, which then let the capacity guard hand the same beds out again.
 *
 * This is the step CLAUDE.md §6 always described — "individual member names
 * are collected later, at room allocation" — that nothing had implemented.
 *
 * Names are placeholders, and deliberately readable rather than blank:
 * `full_name` is NOT NULL, and these rows surface to the client through
 * `client_guest_profiles`, so "Rajesh Sharma (guest 2)" is honest about what
 * is known while still naming the family the person belongs to. Renaming
 * them is ordinary guest editing.
 *
 * Idempotent: it tops up to the headcount and never trims. If a family
 * shrinks after members were placed, the extra rows are somebody's decision
 * to release, not this function's to delete — deleting a guest row would
 * take its room history with it.
 */
export async function ensureGroupMembers(
  eventId: string,
  groupId: string,
): Promise<{ ok: true; result: EnsureMembersResult } | { ok: false; error: string }> {
  const supabase = await createClient()

  const { data: group, error: groupErr } = await supabase
    .from('guest_groups')
    .select('id, head_name, expected_pax, confirmed_pax')
    .eq('id', groupId)
    .eq('event_id', eventId)
    .maybeSingle()

  if (groupErr) return { ok: false, error: friendlyDbError(groupErr) }
  if (!group) return { ok: false, error: 'That family is not on this event.' }

  const { data: existing, error: guestsErr } = await supabase
    .from('guests')
    .select('id, is_head')
    .eq('event_id', eventId)
    .eq('group_id', groupId)
    .order('created_at', { ascending: true })

  if (guestsErr) return { ok: false, error: friendlyDbError(guestsErr) }

  const rows = (existing ?? []) as { id: string; is_head: boolean }[]
  // confirmed_pax is the number a human heard on the phone; expected_pax is
  // the one the spreadsheet guessed. Prefer the confirmed one when it exists.
  const pax = group.confirmed_pax ?? group.expected_pax ?? rows.length
  const missing = Math.max(0, pax - rows.length)

  // A family must always have exactly one head. The import creates the head
  // row, but a group with zero guest rows (or one that lost its head) would
  // otherwise get N placeholder rows all with is_head false — the family
  // then renders as the literal word "Guest" in the rooms grid and client
  // profile card. When no head exists, the first materialised row is the
  // head, named from guest_groups.head_name.
  const hasHead = rows.some((r) => r.is_head)
  const headName = (group.head_name ?? '').trim()
  const headLabel = headName || 'Family head'
  let created = 0

  // A head must always exist. Cases:
  //  - missing > 0 and no head: create the head first (named from head_name),
  //    then the remaining members.
  //  - missing > 0 and head exists: create the members only (current behaviour).
  //  - missing == 0 and no head: the family is already at headcount but every
  //    row is is_head false (the T2.7 shape) — create exactly one head row.
  //    guests_single_head_per_group forbids a second head, so this only fires
  //    when none exists.
  if (missing > 0 || !hasHead) {
    const toInsert: { event_id: string; group_id: string; full_name: string; is_head: boolean }[] = []
    if (!hasHead) {
      toInsert.push({
        event_id: eventId,
        group_id: groupId,
        full_name: headLabel,
        is_head: true,
      })
    }
    // Members to create: everything missing, minus the head row if we are
    // creating one. When missing == 0 (head-only case) this is zero.
    const membersToInsert = Math.max(0, missing - (hasHead ? 0 : 1))
    // Members number from the current row count + the head row (if created)
    // + 1, so a zero-row family gets head "X" then "X (guest 2)".."X (guest N)".
    const memberStart = rows.length + (hasHead ? 0 : 1) + 1
    for (let i = 0; i < membersToInsert; i += 1) {
      toInsert.push({
        event_id: eventId,
        group_id: groupId,
        full_name: `${headLabel} (guest ${memberStart + i})`,
        is_head: false,
      })
    }

    const { data: inserted, error: insertErr } = await supabase
      .from('guests')
      .insert(toInsert)
      .select('id, is_head')

    if (insertErr) return { ok: false, error: friendlyDbError(insertErr) }
    created = inserted?.length ?? 0
    for (const r of inserted ?? []) rows.push({ id: r.id, is_head: r.is_head })
  }

  // Head first, so whichever room takes the first seat shows the family name.
  const head = rows.find((r) => r.is_head)
  const guestIds = head
    ? [head.id, ...rows.filter((r) => r.id !== head.id).map((r) => r.id)]
    : rows.map((r) => r.id)

  return { ok: true, result: { guestIds, created } }
}

/** Top up several families in one call — the allocation commit path. */
export async function ensureMembersForGroups(
  eventId: string,
  groupIds: string[],
): Promise<{ ok: true; byGroup: Record<string, string[]>; created: number } | { ok: false; error: string }> {
  const byGroup: Record<string, string[]> = {}
  let created = 0

  for (const groupId of groupIds) {
    const res = await ensureGroupMembers(eventId, groupId)
    if (!res.ok) return res
    byGroup[groupId] = res.result.guestIds
    created += res.result.created
  }

  return { ok: true, byGroup, created }
}

// ---------------------------------------------------------------------------
// STEP 4 — add one member to a family (the "+" on a family row)
// ---------------------------------------------------------------------------

export type AddGuestMemberResult =
  | { ok: true; guestId: string; guestName: string; groupId: string }
  | { ok: false; error: string }

/**
 * Insert exactly ONE member row for a family, named "<head> (guest N)" —
 * the same placeholder naming the UI uses. Refuses when the family is at or
 * past its headcount. This is the on-demand "+" in the rooms grid: it adds a
 * person the moment you need a bed for them, not a batch top-up to the full
 * headcount (that is ensureGroupMembers, used by the allocation paths).
 *
 * The name is deliberately a placeholder — the design asks for a real name
 * only at check-in or hamper handoff. The returned row immediately enters
 * selection mode so the staff member can place it.
 */
export async function addGuestMember(
  eventId: string,
  groupId: string,
): Promise<AddGuestMemberResult> {
  const supabase = await createClient()

  const { data: group, error: groupErr } = await supabase
    .from('guest_groups')
    .select('id, head_name, expected_pax, confirmed_pax')
    .eq('id', groupId)
    .eq('event_id', eventId)
    .maybeSingle()
  if (groupErr) return { ok: false, error: friendlyDbError(groupErr) }
  if (!group) return { ok: false, error: 'That family is not on this event.' }

  const { data: existing, error: guestsErr } = await supabase
    .from('guests')
    .select('id, is_head')
    .eq('event_id', eventId)
    .eq('group_id', groupId)
    .order('created_at', { ascending: true })
  if (guestsErr) return { ok: false, error: friendlyDbError(guestsErr) }

  const rows = existing ?? []
  const pax = group.confirmed_pax ?? group.expected_pax ?? rows.length
  if (rows.length >= pax) {
    return { ok: false, error: 'This family already has a row for every guest.' }
  }

  const headName = (group.head_name ?? '').trim() || 'Family'
  const { data: inserted, error: insErr } = await supabase
    .from('guests')
    .insert({
      event_id: eventId,
      group_id: groupId,
      full_name: `${headName} (guest ${rows.length + 1})`,
      is_head: false,
    })
    .select('id, full_name, group_id')
    .single()
  if (insErr) return { ok: false, error: friendlyDbError(insErr) }

  return {
    ok: true,
    guestId: inserted.id,
    guestName: inserted.full_name,
    groupId: inserted.group_id,
  }
}

// ---------------------------------------------------------------------------
// Write: move a guest between rooms
// ---------------------------------------------------------------------------

export type MoveGuestsResult =
  | { ok: true; count: number }
  | {
      ok: false
      error: string
      code: 'capacity' | 'other'
      roomId?: string
      roomNumber?: string
      /**
       * Which room-guard refusal this was, when the guard raised the 23514: a
       * full room (`capacity`), an overlapping stay (`overlap`), or reversed
       * dates (`date_order`). `null`/absent when the failure came from anywhere
       * else — same additive shape as `AssignGroupResult.cause`, so the two room
       * write paths answer the "which 23514?" question the same way.
       */
      cause?: RoomGuardCause | null
    }

/**
 * Move several occupants to one room in a SINGLE statement.
 *
 * The merged room guard (20260816130000) is a BEFORE INSERT OR UPDATE FOR
 * EACH ROW trigger that counts the target room's active rows, and — verified
 * live — sees rows already updated by the same statement. So one
 * `UPDATE ... WHERE id IN (...)` is atomic and capacity-aware: either every
 * selected occupant lands in the target room, or none does (23514 aborts the
 * whole statement, zero rows committed). No RPC required.
 *
 * This is the reassign path behind the select-then-place tray. A pure room
 * change never touches guest_id, so room_assignments_one_active_per_guest
 * (which indexes guest_id WHERE released_at is null) is never transiently
 * violated.
 */
export async function moveGuestsToRoom(
  eventId: string,
  assignmentIds: string[],
  targetRoomId: string,
  overrideReason: string | null = null,
): Promise<MoveGuestsResult> {
  const supabase = await createClient()

  if (assignmentIds.length === 0) {
    return { ok: false, error: 'Nothing selected to move.', code: 'other' }
  }

  const { error } = await supabase
    .from('room_assignments')
    .update({
      room_id: targetRoomId,
      is_override: Boolean(overrideReason),
      override_reason: overrideReason || null,
    })
    .eq('event_id', eventId)
    .in('id', assignmentIds)

  if (error) {
    if (error.code === '23514' || error.message?.includes('capacity')) {
      const { data: room } = await supabase
        .from('rooms')
        .select('room_number')
        .eq('id', targetRoomId)
        .maybeSingle()
      // WHICH 23514, read off the trigger's own message, reported additively
      // as `cause` for the new UI to render its own sentence from.
      //
      // THE MESSAGE AND THE `code` BELOW ARE UNCHANGED, DELIBERATELY. This
      // action is shared with the live v1 app, whose override sheet keys on
      // `code: 'capacity'` and prints this sentence. Substituting the per-cause
      // copy here looked like an improvement and was one of the two ways this
      // change could quietly rewrite v1's screen — v1 has no `cause`-aware
      // rendering, so for an overlap it would have read "there is no way to
      // force this one through" above a button offering to force it. v1 keeps
      // its words; the new UI reads `cause` and says the truer thing.
      const cause = roomGuardCause(error)
      return {
        ok: false,
        error: `Room ${room?.room_number ?? targetRoomId} is at capacity. Nothing was moved.`,
        code: 'capacity',
        roomId: targetRoomId,
        roomNumber: room?.room_number ?? '',
        cause,
      }
    }
    return { ok: false, error: friendlyDbError(error), code: 'other' }
  }

  return { ok: true, count: assignmentIds.length }
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

export type AssignGuestResult =
  | { ok: true }
  | { ok: false; error: string; code: 'capacity' | 'other' }
  | { ok: false; error: string; code: 'capacity'; roomId: string; roomNumber: string }

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

  // Top up the family to its headcount BEFORE placing anyone. The import
  // creates one guest row per family (the head), so without this a six-pax
  // family has exactly one assignable person: "assign the head" silently
  // leaves five beds unclaimed and the room reads 1 of 6 occupied.
  // Idempotent, never trims. This mirrors assignGroupToRoom's top-up so the
  // grid's single-guest path and the suggestion panel behave identically.
  const ensured = await ensureGroupMembers(eventId, guest.group_id)
  if (!ensured.ok) {
    return { ok: false, error: ensured.error, code: 'other' }
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
  | {
      ok: false
      error: string
      code?: string
      roomId?: string
      roomNumber?: string
      /**
       * WHICH 23514 this was, when the room guard raised it.
       *
       * `code: 'capacity'` is the override path's signal and stays exactly as it
       * was: the room being full is the only cause a written reason can bypass.
       * But the merged guard raises the same SQLSTATE for an overlapping stay and
       * for a reversed date range, and neither of those can be forced through —
       * so a screen that only knows "23514" ends up offering an override that
       * cannot work. This field is added, and nothing else about this action
       * changes, so the existing callers read the same union they always did.
       */
      cause?: RoomGuardCause | null
    }

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
  const supabase = await createClient()

  // Top up the family's member rows to its headcount FIRST. Without this the
  // import's single head row is the only assignable person, so "assign this
  // family to room 701" put one of six people in the room and reported
  // success. ensureGroupMembers returns them head-first, which is the order
  // this loop wanted anyway.
  const ensured = await ensureGroupMembers(eventId, groupId)
  if (!ensured.ok) return { ok: false, error: ensured.error, code: 'other' }

  const ordered = ensured.result.guestIds
  if (ordered.length === 0) {
    return { ok: false, error: 'This family has no guests to assign.', code: 'other' }
  }

  // ATOMIC: one multi-row INSERT, not a loop. supabase-js resolves with
  // {data, error} rather than throwing, and each call is its own round trip,
  // so a loop that stops on the first failure leaves the earlier rows
  // committed — a family that "stays whole" was actually half-placed. A
  // single INSERT of all rows is one statement: Postgres aborts the whole
  // statement on the first guard violation (the merged room guard fires
  // per-row), so either every member is placed or none is.
  const rows = ordered.map((guestId) => ({
    event_id: eventId,
    room_id: roomId,
    guest_id: guestId,
    group_id: groupId,
    is_override: false,
  }))

  const { error } = await supabase.from('room_assignments').insert(rows)

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
        // Read from the trigger's own message, not guessed. `null` when the
        // failure is a 23514 this classifier does not recognise, which callers
        // treat as "not the capacity case".
        cause: roomGuardCause(error),
      }
    }
    return { ok: false, error: friendlyDbError(error), code: 'other' }
  }

  return { ok: true, assigned: ordered.length }
}

export type AssignGuestsResult =
  | { ok: true; assigned: number; remaining: number }
  | {
      ok: false
      error: string
      code: 'capacity' | 'other'
      roomId?: string
      roomNumber?: string
      cause?: RoomGuardCause | null
    }

/**
 * Put N of a family's unplaced guests into one room.
 *
 * WHY THIS EXISTS, IN ONE SENTENCE FROM A COORDINATOR: "if one family head has 6
 * pax, what is the problem with allocating 2 pax to one room?"
 *
 * There was no problem with it in the database — `room_assignments` is one row
 * per guest and the guards count beds, not families. The problem was that the
 * only door the new UI had was `assignGroupToRoom`, which puts the WHOLE family
 * in one room or nothing. So a family of six could never be placed in a room of
 * two, and the screen answered a correct request with a capacity refusal. v1's
 * grid could do this (it assigns one guest at a time); moving the screen to a
 * family-first flow quietly dropped the capability.
 *
 * WHAT IT DOES. Tops the family's member rows up to its headcount first (the
 * import creates one row per family, so a six-pax family otherwise has exactly
 * one assignable person), drops the guests who already hold an active
 * assignment, takes `count` from what is left — head first — and inserts them in
 * ONE statement.
 *
 * WHY ONE STATEMENT AND NOT A LOOP. Same reason as `assignGroupToRoom`: each
 * call is its own round trip, so a loop that stops on the first refusal leaves
 * the earlier rows committed and the family half-placed with no record of what
 * was intended. A single INSERT is one statement, so the merged room guard
 * either fits all of them or rejects all of them.
 *
 * `remaining` is what the screen needs to keep the family on the list with an
 * honest "4 still to place" instead of guessing.
 */
export async function assignGuestsToRoom(
  eventId: string,
  groupId: string,
  roomId: string,
  count: number,
): Promise<AssignGuestsResult> {
  const wanted = Math.floor(count)
  if (!Number.isFinite(wanted) || wanted < 1) {
    return { ok: false, error: 'Choose how many guests to place.', code: 'other' }
  }

  const supabase = await createClient()

  const ensured = await ensureGroupMembers(eventId, groupId)
  if (!ensured.ok) return { ok: false, error: ensured.error, code: 'other' }

  const ordered = ensured.result.guestIds
  if (ordered.length === 0) {
    return { ok: false, error: 'This family has no guests to assign.', code: 'other' }
  }

  // Who already has a bed. Read AFTER the top-up, so the guests that were just
  // materialised are candidates rather than invisible.
  const { data: placedRows, error: placedErr } = await supabase
    .from('room_assignments')
    .select('guest_id')
    .eq('event_id', eventId)
    .eq('group_id', groupId)
    .is('released_at', null)

  if (placedErr) return { ok: false, error: friendlyDbError(placedErr), code: 'other' }

  const placed = new Set((placedRows ?? []).map((r) => r.guest_id))
  const unplaced = ordered.filter((id) => !placed.has(id))

  if (unplaced.length === 0) {
    return { ok: false, error: 'Everyone in this family already has a room.', code: 'other' }
  }

  // Clamped, not rejected: a screen that asks for four when three are left is
  // asking for all of them, and the answer the caller wants is "three placed",
  // not an error to decode.
  const take = Math.min(wanted, unplaced.length)
  const rows = unplaced.slice(0, take).map((guestId) => ({
    event_id: eventId,
    room_id: roomId,
    guest_id: guestId,
    group_id: groupId,
    is_override: false,
  }))

  const { error } = await supabase.from('room_assignments').insert(rows)

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
        cause: roomGuardCause(error),
      }
    }
    return { ok: false, error: friendlyDbError(error), code: 'other' }
  }

  return { ok: true, assigned: take, remaining: unplaced.length - take }
}

// ---------------------------------------------------------------------------
// The Rooms board: plan, then commit family by family
// ---------------------------------------------------------------------------

export interface RoomPlanRoom {
  roomId: string
  hotelName: string
  roomNumber: string
  floor: string | null
  pax: number
  bedsRemaining: number
  shared: boolean
}

export interface RoomPlanFamily {
  groupId: string
  headName: string
  /** The derived type the rules used: family / couple / single / friends. */
  guestType: GuestType
  side: string | null
  pax: number
  rooms: RoomPlanRoom[]
  /** The one line the review row shows. */
  reason: string
  splitAcrossRooms: boolean
  shared: boolean
}

export interface RoomPlan {
  /** Families this plan can place, in the order the review list shows them. */
  proposals: RoomPlanFamily[]
  /** Families it cannot, each with the reason in plain words. */
  blocked: { groupId: string; headName: string; pax: number; reason: string }[]
  summary: { families: number; guests: number; bedsSpare: number; roomsUsed: number }
}

export type RoomPlanResult =
  | { ok: true; plan: RoomPlan }
  | { ok: false; error: string }

/**
 * Build the auto-allocation proposal for this event. READ ONLY — this is the
 * "Auto-allocate 14 families" tap, and nothing is written until the planner
 * confirms the rows they kept.
 *
 * The engine is `src/lib/allocate/allocator.ts`, the same pure function the
 * unit tests pin. This action only adapts the database shape to it and the
 * result back to something the client can render, so a bug is either in a
 * tested function or in a mapping you can read in one screen.
 */
export async function planRoomAllocation(eventId: string): Promise<RoomPlanResult> {
  const data = await readAllocationData(eventId)

  // A FAILED READ IS NOT "NO ROOMS" (M15). Without this the empty room array a
  // transport failure produces becomes the sentence "No rooms have been added to
  // this event yet." — an assertion about the event, made from a failure to hear
  // about it.
  if (data.error) {
    return { ok: false, error: `Could not read the rooms. ${data.error}` }
  }

  if (data.rooms.length === 0) {
    return { ok: false, error: 'No rooms have been added to this event yet.' }
  }

  const { groups, rooms } = adaptAllocationInput(data)
  const result = allocate(groups, rooms)

  return {
    ok: true,
    plan: {
      proposals: result.placed.map((family) => ({
        groupId: family.groupId,
        headName: family.headName,
        guestType: family.guestType,
        side: family.side,
        pax: family.paxToPlace,
        rooms: family.rooms.map((r) => ({
          roomId: r.roomId,
          hotelName: r.hotelName,
          roomNumber: r.roomNumber,
          floor: r.floor,
          pax: r.paxInRoom,
          bedsRemaining: r.bedsRemaining,
          shared: r.shared,
        })),
        reason: family.reason,
        splitAcrossRooms: family.splitAcrossRooms,
        shared: family.shared,
      })),
      blocked: result.unplaced.map((family) => ({
        groupId: family.groupId,
        headName: family.headName,
        pax: family.paxToPlace,
        reason: family.failureReason ?? 'Could not be placed.',
      })),
      summary: {
        families: result.summary.familiesPlaced,
        guests: result.summary.guestsPlaced,
        bedsSpare: result.summary.bedsSpare,
        roomsUsed: result.summary.roomsUsed,
      },
    },
  }
}

/** Database shape to allocator input. Kept next to its one caller. */
function adaptAllocationInput(data: AllocationData): {
  groups: GroupForAllocation[]
  rooms: RoomForAllocation[]
} {
  const guestsByGroup = new Map<string, AllocationGuest[]>()
  for (const guest of data.guests) {
    const list = guestsByGroup.get(guest.groupId) ?? []
    list.push(guest)
    guestsByGroup.set(guest.groupId, list)
  }

  return {
    groups: data.groups.map((g) => ({
      id: g.id,
      headName: g.headName,
      groupType: g.groupType as GroupForAllocation['groupType'],
      side: g.side as GroupForAllocation['side'],
      expectedPax: g.expectedPax,
      confirmedPax: g.confirmedPax,
      priority: g.priority,
      guests: (guestsByGroup.get(g.id) ?? []).map((guest) => ({
        id: guest.id,
        group_id: guest.groupId,
        is_head: guest.isHead,
        age_band: guest.ageBand as 'adult' | 'child' | 'infant',
      })),
      existingRoomIds: g.existingRoomIds,
    })),
    // `readAllocationData` already drops blocked rooms; `isBlocked: false` is
    // stated anyway so the allocator's own guard is exercised by the shape it
    // is handed rather than by an absence.
    rooms: data.rooms.map((r) => ({ ...r, isBlocked: false })),
  }
}

export interface RoomPlanCommitItem {
  groupId: string
  headName: string
  rooms: { roomId: string; roomNumber: string; pax: number }[]
}

export interface RoomPlanCommitOutcome {
  groupId: string
  headName: string
  placed: boolean
  /** Beds actually written for this family. */
  guests: number
  /** Why it did not land, in words a person on a landing can act on. */
  reason: string | null
}

export interface RoomPlanCommitResult {
  /** Families written. */
  families: number
  /** Guests written. */
  guests: number
  outcomes: RoomPlanCommitOutcome[]
}

/**
 * Write the rows the planner kept — ONE FAMILY AT A TIME, on purpose.
 *
 * `commitAllocations` inserts the whole plan in a single statement, which means
 * one family over a room's ceiling aborts every other family with it. On a
 * fourteen-family plan that is thirteen correct placements thrown away for one
 * refusal, and nothing on the screen can say which one. Here each family is its
 * own INSERT: the merged room guard still fires per row, so a family is placed
 * WHOLE or not at all (never half a family in a room), and the failures come
 * back named with the guard's own reason.
 *
 * Every family is topped up to its headcount first. The Excel import creates
 * one `guests` row per family — the head — so without that step a family of six
 * has exactly one assignable person and the room reads 1 of 6 beds taken
 * (CLAUDE.md section 12).
 */
export async function commitRoomPlan(
  eventId: string,
  items: RoomPlanCommitItem[],
): Promise<RoomPlanCommitResult> {
  if (items.length === 0) {
    return { families: 0, guests: 0, outcomes: [] }
  }

  const supabase = await createClient()

  const ensured = await ensureMembersForGroups(
    eventId,
    items.map((i) => i.groupId),
  )
  if (!ensured.ok) {
    return {
      families: 0,
      guests: 0,
      outcomes: items.map((i) => ({
        groupId: i.groupId,
        headName: i.headName,
        placed: false,
        guests: 0,
        reason: ensured.error,
      })),
    }
  }

  // Who already holds a bed, for every family in this commit — ONE read, not
  // one per family. The top-up above may have created rows since the plan was
  // built, so this is read after it and never before.
  const { data: placedRows, error: placedErr } = await supabase
    .from('room_assignments')
    .select('guest_id, group_id')
    .eq('event_id', eventId)
    .in('group_id', items.map((i) => i.groupId))
    .is('released_at', null)

  if (placedErr) {
    return {
      families: 0,
      guests: 0,
      outcomes: items.map((i) => ({
        groupId: i.groupId,
        headName: i.headName,
        placed: false,
        guests: 0,
        reason: friendlyDbError(placedErr),
      })),
    }
  }

  const alreadyPlaced = new Set((placedRows ?? []).map((r) => r.guest_id))
  const outcomes: RoomPlanCommitOutcome[] = []
  let families = 0
  let guests = 0

  for (const item of items) {
    const candidates = (ensured.byGroup[item.groupId] ?? []).filter((id) => !alreadyPlaced.has(id))

    if (candidates.length === 0) {
      outcomes.push({
        groupId: item.groupId,
        headName: item.headName,
        placed: false,
        guests: 0,
        reason: 'Everyone in this family already has a bed.',
      })
      continue
    }

    // Head first, then down the plan's rooms in order. Which individual sleeps
    // in which of a family's two rooms is not knowable here — member names are
    // collected at check-in — so this is a stable order, not a claim.
    const rows: {
      event_id: string
      room_id: string
      guest_id: string
      group_id: string
      is_override: boolean
    }[] = []
    let cursor = 0
    for (const room of item.rooms) {
      for (let i = 0; i < room.pax && cursor < candidates.length; i += 1, cursor += 1) {
        rows.push({
          event_id: eventId,
          room_id: room.roomId,
          guest_id: candidates[cursor],
          group_id: item.groupId,
          is_override: false,
        })
      }
    }

    if (rows.length === 0) {
      outcomes.push({
        groupId: item.groupId,
        headName: item.headName,
        placed: false,
        guests: 0,
        reason: 'No rooms were chosen for this family.',
      })
      continue
    }

    const { error } = await supabase.from('room_assignments').insert(rows)

    if (error) {
      const first = item.rooms[0]
      const cause = roomGuardCause(error)
      outcomes.push({
        groupId: item.groupId,
        headName: item.headName,
        placed: false,
        guests: 0,
        reason:
          roomGuardMessage(cause, { roomNumber: first?.roomNumber ?? null }) ??
          friendlyDbError(error),
      })
      continue
    }

    families += 1
    guests += rows.length
    for (const row of rows) alreadyPlaced.add(row.guest_id)
    outcomes.push({
      groupId: item.groupId,
      headName: item.headName,
      placed: true,
      guests: rows.length,
      reason: null,
    })
  }

  return { families, guests, outcomes }
}
