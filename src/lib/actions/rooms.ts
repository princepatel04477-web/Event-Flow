'use server'

import { createClient } from '@/lib/supabase/server'
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
  /** Confirmed families placed but below their headcount (Phase 3). */
  underBedded: UnderBeddedFamily[]
}

export async function readRoomsGrid(eventId: string): Promise<RoomsGridData> {
  const timing = phaseTiming('rooms :: readRoomsGrid')
  const supabase = await createClient()
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
    .select('id, head_name, primary_mobile, rsvp_status, expected_pax, confirmed_pax')
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

  const roomsRaw = roomsRes.data ?? []
  const assignments = assignmentsRes.data ?? []
  const hotelRows = hotelsRes.data ?? []
  const guestsAll = guestsRes.data ?? []
  const groupRows = groupsRes.data ?? []
  const hamperRows = hampersRes.data ?? []

  const hotelNames = new Map(hotelRows.map((h) => [h.id, h.name]))
  const groupNames = new Map(groupRows.map((g) => [g.id, g.head_name]))
  const groupMobiles = new Map(groupRows.map((g) => [g.id, g.primary_mobile]))
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
    })
  }

  timing.mark('assemble')
  timing.report()
  return { rooms, unplaced, underBedded }
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
