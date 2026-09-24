import type { Database } from '@/lib/supabase/database.types'

import type {
  AssignmentRow,
  CallOutcome,
  CallStatRow,
  ClientProfileRow,
  DeliverableRow,
  EventState,
  GroupRow,
  GroupType,
  GuestRow,
  LegRow,
  ProofRow,
  RsvpStatus,
  Side,
  StoreOp,
  TravelDirection,
} from './types'

/**
 * Every screen's rows, derived from the store.
 *
 * WHY DERIVE INSTEAD OF STORING SCREEN SHAPES. The server reads each screen
 * used to make (`readRoomsGrid`, `v_rsvp_queue`, the travel join, the Today
 * board view) were not raw tables — they were each a small projection with
 * counts, joins and anti-joins. A store that held raw tables would just move
 * those queries into components, once per render, which is how the phone ends
 * up slower than the network it replaced. So each screen's projection is
 * rebuilt here, once, memoised against the state object.
 *
 * THE PROJECTIONS ARE DELIBERATELY COPIES OF THE SQL. `selectRoomsGrid` is
 * `readRoomsGrid`'s body with `supabase` removed, `selectQueueRows` is
 * `v_rsvp_queue`'s select list, and `selectTodayNumbers` is `v_event_board`'s
 * subqueries. That is not laziness: two independent implementations of "how
 * many guests have a bed" is how the Today tile and the Rooms header start
 * disagreeing, and the disagreement is invisible until somebody counts.
 *
 * MEMOISATION IS ON THE STATE OBJECT, NOT ON ARGUMENTS. The engine replaces the
 * state object on every change and copies only the record maps an op touched,
 * so `state.rooms === previous.rooms` means the room list cannot have changed.
 * A selector that reads only the maps it needs therefore keeps its identity
 * across unrelated writes, which is what lets `useEventStore` avoid
 * re-rendering the Rooms board when a call outcome lands.
 */

/* ------------------------------------------------------------------ */
/* Memo                                                                */
/* ------------------------------------------------------------------ */

/**
 * Per-state memo, for selectors whose arguments are part of their key
 * (`find:<term>`, `family:<id>`). Bounded by the lifetime of the state object,
 * so a search box that produces a hundred terms produces a hundred entries on
 * that state and none on the next — which is why the parameterised selectors use
 * this one and not `stable` below.
 */
const memo = new WeakMap<EventState, Map<string, unknown>>()

function cached<T>(state: EventState, key: string, build: () => T): T {
  let bucket = memo.get(state)
  if (!bucket) {
    bucket = new Map()
    memo.set(state, bucket)
  }
  const hit = bucket.get(key)
  if (hit !== undefined) return hit as T
  const value = build()
  bucket.set(key, value)
  return value
}

/**
 * Memo keyed on the IDENTITY OF THE INPUTS rather than on the state object.
 *
 * WHY THIS EXISTS, and it is the whole reason the store is cheap. The engine
 * creates a new state object for every write and copies only the record maps
 * that write touched, so `state.rooms === previous.rooms` proves the room list
 * cannot have changed. A memo keyed on the state object would miss that — every
 * call outcome logged on the Calls tab would rebuild the Rooms grid, the
 * check-in board and the hamper run, none of which moved. Keyed on the input
 * maps, an unrelated write returns the SAME array identity, `useEventStore`'s
 * `Object.is` sees no change, and the screen does not re-render at all.
 *
 * The number of keys is bounded by the parameterless selectors plus two travel
 * directions and one date, so the map cannot grow with use. Anything whose key
 * contains user input uses `cached` instead.
 */
const stableMemo = new Map<string, { deps: readonly unknown[]; value: unknown }>()

function stable<T>(key: string, deps: readonly unknown[], build: () => T): T {
  const hit = stableMemo.get(key)
  if (hit && hit.deps.length === deps.length && hit.deps.every((dep, i) => dep === deps[i])) {
    return hit.value as T
  }
  const value = build()
  stableMemo.set(key, { deps, value })
  return value
}

/* ------------------------------------------------------------------ */
/* Shared indexes                                                      */
/* ------------------------------------------------------------------ */

interface Derived {
  guestsByGroup: Map<string, GuestRow[]>
  activeAssignmentsByRoom: Map<string, AssignmentRow[]>
  activeAssignmentsByGroup: Map<string, AssignmentRow[]>
  legsByGroup: Map<string, { arrival: LegRow[]; departure: LegRow[] }>
  deliverablesByGroup: Map<string, DeliverableRow[]>
  proofsByDeliverable: Map<string, ProofRow[]>
  hamperDelivered: Set<string>
  returnGiftDelivered: Set<string>
  /** `hotel name + room number` for a group's active stay, as travel renders it. */
  roomLabelByGroup: Map<string, string>
  /** `{hotel} {room}` per room, for the check-in board. */
  roomLabelByRoom: Map<string, string>
  staffNames: Record<string, string>
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

function buildDerived(state: EventState): Derived {
  const guestsByGroup = new Map<string, GuestRow[]>()
  for (const guest of Object.values(state.guests)) push(guestsByGroup, guest.group_id, guest)

  const activeAssignmentsByRoom = new Map<string, AssignmentRow[]>()
  const activeAssignmentsByGroup = new Map<string, AssignmentRow[]>()
  for (const assignment of Object.values(state.assignments)) {
    push(activeAssignmentsByRoom, assignment.room_id, assignment)
    push(activeAssignmentsByGroup, assignment.group_id, assignment)
  }

  const legsByGroup = new Map<string, { arrival: LegRow[]; departure: LegRow[] }>()
  for (const leg of Object.values(state.legs)) {
    let bucket = legsByGroup.get(leg.group_id)
    if (!bucket) {
      bucket = { arrival: [], departure: [] }
      legsByGroup.set(leg.group_id, bucket)
    }
    bucket[leg.direction].push(leg)
  }

  const deliverablesByGroup = new Map<string, DeliverableRow[]>()
  const hamperDelivered = new Set<string>()
  const returnGiftDelivered = new Set<string>()
  for (const item of Object.values(state.deliverables)) {
    push(deliverablesByGroup, item.group_id, item)
    if (item.status !== 'delivered') continue
    if (item.kind === 'hamper' && item.guest_id === null) hamperDelivered.add(item.group_id)
    if (item.kind === 'return_gift') returnGiftDelivered.add(item.group_id)
  }

  const proofsByDeliverable = new Map<string, ProofRow[]>()
  for (const proof of Object.values(state.proofs)) {
    push(proofsByDeliverable, proof.deliverable_id, proof)
  }

  const roomLabelByRoom = new Map<string, string>()
  for (const room of Object.values(state.rooms)) {
    const hotel = state.hotels[room.hotel_id]
    roomLabelByRoom.set(room.id, [hotel?.name, room.room_number].filter(Boolean).join(' '))
  }

  // The FIRST active assignment wins, matching `client_guest_profiles`' lateral
  // join (`order by … limit 1`) and TravelBoard's own `roomByGroup` map. A group
  // with two active assignments (a split family) shows the first.
  const roomLabelByGroup = new Map<string, string>()
  for (const assignment of Object.values(state.assignments)) {
    if (roomLabelByGroup.has(assignment.group_id)) continue
    const label = roomLabelByRoom.get(assignment.room_id)
    if (label) roomLabelByGroup.set(assignment.group_id, label)
  }

  const staffNames: Record<string, string> = {}
  for (const member of Object.values(state.staff)) {
    staffNames[member.id] = member.full_name
  }

  return {
    guestsByGroup,
    activeAssignmentsByRoom,
    activeAssignmentsByGroup,
    legsByGroup,
    deliverablesByGroup,
    proofsByDeliverable,
    hamperDelivered,
    returnGiftDelivered,
    roomLabelByGroup,
    roomLabelByRoom,
    staffNames,
  }
}

function derived(state: EventState): Derived {
  return stable(
    'derived',
    [
      state.guests,
      state.assignments,
      state.legs,
      state.deliverables,
      state.proofs,
      state.rooms,
      state.hotels,
      state.staff,
    ],
    () => buildDerived(state),
  )
}

/** The name a screen should show for a guest row: the head wears the family name. */
function guestDisplayName(state: EventState, guest: GuestRow): string {
  if (guest.is_head) return state.groups[guest.group_id]?.head_name ?? guest.full_name
  return guest.full_name
}

/**
 * Is this session allowed a staff projection at all?
 *
 * The real fence is the server: `app.event_snapshot` returns a client the event
 * header, `client_guest_profiles` and NOTHING else, and the base tables return
 * zero rows under RLS for a client anyway. So this check cannot be the thing
 * that keeps a client out — but it is cheap, it is total, and it means a future
 * payload bug (or a fixture) cannot turn a client session into a calling list.
 * Belt and braces on the one boundary in this app that must never leak.
 */
function isStaffSession(state: EventState): boolean {
  return state.role !== 'client'
}

const NO_QUEUE: QueueRow[] = []
const NO_CHECK_INS: CheckInRow[] = []
const NO_DELIVERIES: DeliveryRunRow[] = []
const NO_TRAVEL: TravelRow[] = []
/** All-zero board, for the one session type that may not read one. */
const EMPTY_TODAY: TodayNumbers = {
  totalGroups: 0,
  totalPax: 0,
  rsvpConfirmed: 0,
  rsvpPending: 0,
  guestsRoomed: 0,
  hampersDelivered: 0,
  hampersPending: 0,
  arrivalsToday: 0,
  departuresToday: 0,
  confirmedNoRoom: 0,
  arrivalsNoVehicle: 0,
  noDeparture: 0,
}

/** `coalesce(confirmed_pax, expected_pax)` — the headcount, in one place. */
export function headcount(group: GroupRow): number {
  return group.confirmed_pax ?? group.expected_pax
}

/* ------------------------------------------------------------------ */
/* Calls — the RSVP queue                                              */
/* ------------------------------------------------------------------ */

/**
 * One row per family, in `v_rsvp_queue`'s shape.
 *
 * The four aggregate columns come from `callStats`, which the migration
 * reduces server-side; `is_locked` is recomputed here because it is a function
 * of `now()` and `locked_until`, and a lock that expires while the screen is
 * open must not keep showing as held. That recomputation uses the PHONE clock,
 * which is the one thing in this file the server would have done differently —
 * and it is the right way round: the phone is the device the caller is looking
 * at, and the lock's own duration is what matters, not the server's opinion of
 * the wall clock.
 */
export interface QueueRow {
  group_id: string | null
  head_name: string | null
  primary_mobile: string | null
  group_type: string | null
  side: string | null
  expected_pax: number | null
  confirmed_pax: number | null
  rsvp_status: string | null
  priority: number | null
  is_locked: boolean | null
  locked_by_staff: string | null
  locked_until: string | null
  attempt_count: number | null
  last_outcome: string | null
  next_callback_at: string | null
  remarks: string | null
}

export function selectQueueRows(state: EventState): QueueRow[] {
  if (!isStaffSession(state)) return NO_QUEUE
  return stable(
    'queueRows',
    [state.groups, state.callStats],
    () => {
      const nowIso = new Date().toISOString()
      const rows: QueueRow[] = []

      for (const group of Object.values(state.groups)) {
        const stat: CallStatRow | undefined = state.callStats[group.id]
        rows.push({
          group_id: group.id,
          head_name: group.head_name,
          primary_mobile: group.primary_mobile,
          group_type: group.group_type,
          side: group.side,
          expected_pax: group.expected_pax,
          confirmed_pax: group.confirmed_pax,
          rsvp_status: group.rsvp_status,
          priority: group.priority,
          is_locked: group.locked_until !== null && group.locked_until > nowIso,
          locked_by_staff: group.locked_by_staff,
          locked_until: group.locked_until,
          attempt_count: stat?.n ?? 0,
          last_outcome: stat?.lastOutcome ?? null,
          next_callback_at: stat?.nextCallbackAt ?? null,
          remarks: group.remarks,
        })
      }

      // v_rsvp_queue's order: fewest attempts first, then least-recently dialled,
      // then the family, then the name. `nulls last` on the last-attempt column
      // matches Postgres' ASC default, which the PostgREST read relied on.
      rows.sort((a, b) => {
        const attempts = (a.attempt_count ?? 0) - (b.attempt_count ?? 0)
        if (attempts !== 0) return attempts
        const aAt = state.callStats[a.group_id ?? '']?.lastAt ?? null
        const bAt = state.callStats[b.group_id ?? '']?.lastAt ?? null
        if (aAt !== bAt) {
          if (aAt === null) return 1
          if (bAt === null) return -1
          return aAt < bAt ? -1 : 1
        }
        const priority = (b.priority ?? 0) - (a.priority ?? 0)
        if (priority !== 0) return priority
        return (a.head_name ?? '').localeCompare(b.head_name ?? '')
      })

      return rows
  })
}

/** The full family record the capture step reads. `FamilyRow` in the screen. */
export interface FamilyRow {
  id: string
  head_name: string
  primary_mobile: string | null
  expected_pax: number
  confirmed_pax: number | null
  adults_confirmed: number | null
  children_confirmed: number | null
  needs_pickup: boolean
  special_requirements: string[]
  rsvp_status: RsvpStatus
  group_type: GroupType
  side: Side | null
  remarks: string | null
}

export function selectFamily(state: EventState, groupId: string | null): FamilyRow | null {
  if (!groupId) return null
  return cached(state, `family:${groupId}`, () => {
    const group = state.groups[groupId]
    if (!group) return null
    return {
      id: group.id,
      head_name: group.head_name,
      primary_mobile: group.primary_mobile,
      expected_pax: group.expected_pax,
      confirmed_pax: group.confirmed_pax,
      adults_confirmed: group.adults_confirmed,
      children_confirmed: group.children_confirmed,
      needs_pickup: group.needs_pickup,
      special_requirements: group.special_requirements,
      rsvp_status: group.rsvp_status,
      group_type: group.group_type,
      side: group.side,
      remarks: group.remarks,
    }
  })
}

/**
 * `staff_members.id → full_name`.
 *
 * The lock note and the presence label both need a name for an id, and this is
 * the map that has one — it replaces the `useStaffNames` query the queue used
 * to make on every mount.
 */
export function selectStaffNames(state: EventState): Record<string, string> {
  return stable(
    'staffNames',
    [state.staff],
    () => {
      const names: Record<string, string> = {}
      for (const member of Object.values(state.staff)) names[member.id] = member.full_name
      return names
    },
  )
}

/**
 * The same roster in `StaffNameLookup`'s shape, for `lockNote`.
 *
 * A selector of its own rather than a helper over `selectStaffNames`, because
 * the lookup OBJECT is what `currentLock`'s `useMemo` depends on: building a
 * fresh `{ nameOf }` per render would recompute the lock sentence on every
 * keystroke on the screen.
 */
export function selectStaffLookup(state: EventState): {
  nameOf: (id: string | null | undefined) => string | null
} {
  return stable('staffLookup', [state.staff], () => {
    const names: Record<string, string> = {}
    for (const member of Object.values(state.staff)) names[member.id] = member.full_name
    return {
      nameOf: (id: string | null | undefined) => (id ? (names[id] ?? null) : null),
    }
  })
}

/* ------------------------------------------------------------------ */
/* Rooms — the board                                                   */
/* ------------------------------------------------------------------ */

export interface RoomGridGuest {
  guestId: string
  guestName: string
  groupId: string
  headName: string
  primaryMobile: string | null
  hamperDelivered: boolean
  ageBand: string
  isHead: boolean
  assignmentId: string
  groupType: string
  side: string | null
}

export interface RoomGridRow {
  roomId: string
  hotelId: string
  hotelName: string
  roomNumber: string
  capacity: number
  maxCapacity: number
  floor: string | null
  isBlocked: boolean
  occupants: RoomGridGuest[]
  freeBeds: number
  isOverCapacity: boolean
}

export interface UnderBeddedFamily {
  groupId: string
  headName: string
  headcount: number
  memberRows: number
  placed: number
  shortfall: number
  needsTopUp: boolean
  groupType: string
  side: string | null
}

export interface RoomsBoardTotals {
  confirmedGuests: number
  guestsWithBed: number
  bedsFree: number
  familiesWaiting: number
}

export interface RoomsGridData {
  rooms: RoomGridRow[]
  unplaced: {
    guestId: string
    guestName: string
    groupId: string
    headName: string
    groupType: string
    side: string | null
  }[]
  underBedded: UnderBeddedFamily[]
  totals: RoomsBoardTotals
}

export const EMPTY_ROOMS_GRID: RoomsGridData = {
  rooms: [],
  unplaced: [],
  underBedded: [],
  totals: { confirmedGuests: 0, guestsWithBed: 0, bedsFree: 0, familiesWaiting: 0 },
}

/**
 * The whole board, in one pass — `readRoomsGrid` without the six round trips.
 *
 * The maps are built once and every list is a reduce over them, exactly as the
 * server function did after its "precompute lookup maps once" comment: the
 * nested form was a full re-scan per room card at 238 families.
 */
export function selectRoomsGrid(state: EventState): RoomsGridData {
  if (!isStaffSession(state)) return EMPTY_ROOMS_GRID
  return stable(
    'roomsGrid',
    [state.rooms, state.hotels, state.groups, state.guests, state.assignments, state.deliverables],
    () => {
      const index = derived(state)
      const groups = state.groups

      const rooms: RoomGridRow[] = Object.values(state.rooms)
        .slice()
        .sort((a, b) => a.room_number.localeCompare(b.room_number))
        .map((room) => {
          const occupants: RoomGridGuest[] = (
            index.activeAssignmentsByRoom.get(room.id) ?? []
          ).map((assignment) => {
            const guest = state.guests[assignment.guest_id]
            const group = groups[assignment.group_id]
            return {
              guestId: assignment.guest_id,
              guestName: guest ? guestDisplayName(state, guest) : 'Guest',
              groupId: assignment.group_id,
              headName: group?.head_name ?? 'Unknown',
              primaryMobile: group?.primary_mobile ?? null,
              hamperDelivered: index.hamperDelivered.has(assignment.group_id),
              ageBand: guest?.age_band ?? 'adult',
              isHead: guest?.is_head ?? false,
              assignmentId: assignment.id,
              groupType: group?.group_type ?? 'family',
              side: group?.side ?? null,
            }
          })

          const occupied = occupants.length
          return {
            roomId: room.id,
            hotelId: room.hotel_id,
            hotelName: state.hotels[room.hotel_id]?.name ?? 'Unknown hotel',
            roomNumber: room.room_number,
            capacity: room.capacity,
            maxCapacity: room.max_capacity,
            floor: room.floor,
            isBlocked: room.is_blocked,
            occupants,
            freeBeds: Math.max(0, room.capacity - occupied),
            isOverCapacity: occupied > room.capacity,
          }
        })

      const assignedGuestIds = new Set(
        Object.values(state.assignments).map((assignment) => assignment.guest_id),
      )
      const confirmedGroupIds = new Set(
        Object.values(groups)
          .filter((group) => group.rsvp_status === 'confirmed')
          .map((group) => group.id),
      )

      const unplaced = Object.values(state.guests)
        .filter(
          (guest) => !assignedGuestIds.has(guest.id) && confirmedGroupIds.has(guest.group_id),
        )
        .map((guest) => {
          const group = groups[guest.group_id]
          return {
            guestId: guest.id,
            guestName: guestDisplayName(state, guest),
            groupId: guest.group_id,
            headName: group?.head_name ?? 'Unknown',
            groupType: group?.group_type ?? 'family',
            side: group?.side ?? null,
          }
        })

      const placedByGroup = new Map<string, number>()
      for (const assignment of Object.values(state.assignments)) {
        placedByGroup.set(assignment.group_id, (placedByGroup.get(assignment.group_id) ?? 0) + 1)
      }

      const underBedded: UnderBeddedFamily[] = []
      let confirmedGuests = 0
      for (const group of Object.values(groups)) {
        if (group.rsvp_status !== 'confirmed') continue
        const count = headcount(group)
        if (!count || count <= 0) continue
        confirmedGuests += count
        const placed = placedByGroup.get(group.id) ?? 0
        if (placed >= count) continue
        const memberRows = index.guestsByGroup.get(group.id)?.length ?? 0
        underBedded.push({
          groupId: group.id,
          headName: group.head_name,
          headcount: count,
          memberRows,
          placed,
          shortfall: count - placed,
          // Fewer `guests` rows than the family's headcount: somebody has to
          // collect the missing names before the family can be placed properly.
          needsTopUp: memberRows < count,
          groupType: group.group_type,
          side: group.side,
        })
      }

      const totals: RoomsBoardTotals = {
        confirmedGuests,
        // Beds held by CONFIRMED families. An assignment belonging to a family
        // that later declined is not a guest with a bed.
        guestsWithBed: Object.values(state.assignments).filter((assignment) =>
          confirmedGroupIds.has(assignment.group_id),
        ).length,
        bedsFree: rooms
          .filter((room) => !room.isBlocked)
          .reduce((sum, room) => sum + room.freeBeds, 0),
        familiesWaiting: underBedded.length,
      }

      return { rooms, unplaced, underBedded, totals }
  })
}

/* ------------------------------------------------------------------ */
/* Check-in                                                            */
/* ------------------------------------------------------------------ */

/**
 * The check-in board's rows.
 *
 * `event_id` IS PUT BACK on the two embedded rows. The screen's `CheckInRow`
 * was written against the raw table rows (`RoomAssignmentRow` / `GuestGroupRow`,
 * both of which carry `event_id`), and it renders neither. Re-attaching one
 * string per row is cheaper than rewriting a working screen's types and keeps
 * the derived shape a strict superset of what it replaces.
 */
export interface CheckInRow {
  assignment: Database['public']['Tables']['room_assignments']['Row']
  group: Database['public']['Tables']['guest_groups']['Row']
  roomLabel: string
  occupiedByOther: string | null
  pendingDeliverables: string[]
}

export function selectCheckInRows(state: EventState): CheckInRow[] {
  if (!isStaffSession(state)) return NO_CHECK_INS
  return stable(
    'checkInRows',
    [state.assignments, state.groups, state.rooms, state.hotels, state.deliverables],
    () => {
      const index = derived(state)
      const rows: CheckInRow[] = []

      for (const assignment of Object.values(state.assignments)) {
        const group = state.groups[assignment.group_id]
        // The old read dropped assignments whose group no longer exists (it
        // joined on the group map). Same rule here, so the "expected families"
        // denominator is the same number.
        if (!group) continue

        const occupiedByOther = (
          index.activeAssignmentsByRoom.get(assignment.room_id) ?? []
        ).find(
          (other) =>
            other.id !== assignment.id &&
            other.checked_in_at !== null &&
            other.checked_out_at === null,
        )

        const pendingDeliverables = (index.deliverablesByGroup.get(assignment.group_id) ?? [])
          .filter((item) => item.status !== 'delivered')
          .map((item) => (item.kind === 'return_gift' ? 'Return gift' : 'Hamper'))

        rows.push({
          assignment: { ...assignment, event_id: state.eventId },
          group: { ...group, event_id: state.eventId, source_row_hash: null },
          roomLabel: index.roomLabelByRoom.get(assignment.room_id) ?? 'Room',
          occupiedByOther: occupiedByOther
            ? (state.groups[occupiedByOther.group_id]?.head_name ?? null)
            : null,
          pendingDeliverables,
        })
      }

      rows.sort((a, b) => a.roomLabel.localeCompare(b.roomLabel, undefined, { numeric: true }))
      return rows
  })
}

/* ------------------------------------------------------------------ */
/* Hampers                                                             */
/* ------------------------------------------------------------------ */

export interface DeliveryRunRow {
  id: string
  kind: 'hamper' | 'return_gift'
  status: string
  group_id: string
  head_name: string | null
  primary_mobile: string | null
  hotel_name: string | null
  room_number: string | null
  floor: string | null
  item_name: string | null
  quantity: number
  assigned_to: string | null
}

/**
 * The hamper run, in `readDeliveryRun`'s shape.
 *
 * THE ROOM IS RESOLVED IN TWO STEPS, and the order matters. `deliverables.room_id`
 * is set at generation time and is the deliverable's own claim about where it
 * goes; the group's ACTIVE assignment is where the family actually is. The old
 * read selected the embed through `deliverables.room_id`, so that is preferred
 * — but a family moved after the hamper was generated would then show the old
 * room, which is the bug the fallback exists to soften. Prefer the live
 * assignment when there is one, because a runner walking the corridor needs the
 * room the family is in.
 */
export function selectDeliveryRun(state: EventState): DeliveryRunRow[] {
  if (!isStaffSession(state)) return NO_DELIVERIES
  return stable(
    'deliveryRun',
    [state.deliverables, state.groups, state.rooms, state.hotels, state.assignments],
    () => {
      const index = derived(state)
      return Object.values(state.deliverables).map((item) => {
        const group = state.groups[item.group_id]
        const liveRoomId =
          index.activeAssignmentsByGroup.get(item.group_id)?.[0]?.room_id ?? item.room_id
        const room = liveRoomId ? state.rooms[liveRoomId] : undefined
        return {
          id: item.id,
          kind: item.kind,
          status: item.status,
          group_id: item.group_id,
          head_name: group?.head_name ?? null,
          primary_mobile: group?.primary_mobile ?? null,
          hotel_name: room ? (state.hotels[room.hotel_id]?.name ?? null) : null,
          room_number: room?.room_number ?? null,
          floor: room?.floor ?? null,
          item_name: item.item_name,
          quantity: item.quantity,
          assigned_to: item.assigned_to,
        }
      })
  })
}

/** Proofs already captured for one deliverable — the "is it photographed" flag. */
export function selectProofsFor(state: EventState, deliverableId: string): ProofRow[] {
  return derived(state).proofsByDeliverable.get(deliverableId) ?? []
}

/* ------------------------------------------------------------------ */
/* Travel                                                             */
/* ------------------------------------------------------------------ */

export interface TravelLegLike {
  id: string
  group_id: string
  mode: string | null
  travel_date: string | null
  travel_time: string | null
  reference: string | null
  point: string | null
  pax_on_leg: number | null
  arrived_at: string | null
  departed_at: string | null
}

export interface TravelGroupLike {
  id: string
  head_name: string | null
  primary_mobile: string | null
  expected_pax: number | null
  adults_confirmed: number | null
  children_confirmed: number | null
  needs_pickup: boolean | null
}

export interface TravelRow {
  leg: TravelLegLike
  group: TravelGroupLike
  roomLabel: string
}

/**
 * One row per leg in one direction, joined to its family.
 *
 * The old queryFn dropped legs whose group it could not find (the group read
 * was flat, not an inner join, and the queryFn filtered afterwards), and it
 * ordered by date then time. Both are reproduced, including the drop: an
 * orphan leg has no name to show and no phone to dial.
 */
export function selectTravelRows(state: EventState, direction: TravelDirection): TravelRow[] {
  if (!isStaffSession(state)) return NO_TRAVEL
  return stable(
    `travel:${direction}`,
    [state.legs, state.groups, state.rooms, state.hotels, state.assignments],
    () => {
      const index = derived(state)
      const rows: TravelRow[] = []

      for (const leg of Object.values(state.legs)) {
        if (leg.direction !== direction) continue
        const group = state.groups[leg.group_id]
        if (!group) continue
        rows.push({
          leg: {
            id: leg.id,
            group_id: leg.group_id,
            mode: leg.mode,
            travel_date: leg.travel_date,
            travel_time: leg.travel_time,
            reference: leg.reference,
            point: leg.point,
            pax_on_leg: leg.pax_on_leg,
            arrived_at: leg.arrived_at,
            departed_at: leg.departed_at,
          },
          group: {
            id: group.id,
            head_name: group.head_name,
            primary_mobile: group.primary_mobile,
            expected_pax: group.expected_pax,
            adults_confirmed: group.adults_confirmed,
            children_confirmed: group.children_confirmed,
            needs_pickup: group.needs_pickup,
          },
          roomLabel: index.roomLabelByGroup.get(leg.group_id) ?? '',
        })
      }

      rows.sort((a, b) => {
        const dateA = a.leg.travel_date ?? ''
        const dateB = b.leg.travel_date ?? ''
        if (dateA !== dateB) {
          // A leg with no date sorts last: it is the one still to be completed,
          // not the one at the top of the list.
          if (dateA === '') return 1
          if (dateB === '') return -1
          return dateA < dateB ? -1 : 1
        }
        const timeA = a.leg.travel_time ?? ''
        const timeB = b.leg.travel_time ?? ''
        if (timeA !== timeB) {
          if (timeA === '') return 1
          if (timeB === '') return -1
          return timeA < timeB ? -1 : 1
        }
        return (a.group.head_name ?? '').localeCompare(b.group.head_name ?? '')
      })

      return rows
  })
}

/* ------------------------------------------------------------------ */
/* Find and the guest directories                                      */
/* ------------------------------------------------------------------ */

export interface FindResult {
  profile: ClientProfileRow
  groupId: string | null
}

/** The RPC's row shape, as `FindResult.groupId`'s other half. */
function groupIdForGuest(state: EventState, guestId: string | null): string | null {
  if (!guestId) return null
  return state.guests[guestId]?.group_id ?? null
}

/**
 * Guest search, locally.
 *
 * WHAT THIS REPLACES, AND WHY THE PHONE CAN DO IT. The old search was two
 * server legs per keystroke (`limit 50` each): the view for name / family head
 * / room, and `search_guest_profiles` for the mobile number, merged so the
 * view's row won where both matched. Both legs are now one pass over
 * `state.client`, which holds the view's rows verbatim, plus the guest list
 * the phone already has for the mobile match.
 *
 * THE MATCH SET IS IDENTICAL, on purpose: name, family head, room number, and
 * (for staff only) the mobile number. The mobile leg stays staff-only for the
 * reason `reads.ts` documents at length — a client must never be handed a phone
 * number, and a client payload has no `guests` map to search anyway.
 *
 * `rsvp_status` IS NULLED ON MOBILE-ONLY MATCHES, exactly as the old
 * `asProfileRow` did: the RPC has no `rsvp_status` column, so a row that only
 * the RPC found renders without the pill rather than with a wrong one.
 *
 * Returns nothing for a term under two characters, which is the same threshold
 * the debounced input used — a one-letter search over 465 guests matches most
 * of them and answers nothing.
 */
export function selectFindResults(state: EventState, term: string): FindResult[] {
  const needle = term.trim().toLowerCase()
  if (needle.length < 2) return EMPTY_FIND
  return cached(state, `find:${needle}`, () => {
    const limit = 50
    const seen = new Set<string>()
    const results: FindResult[] = []

    const isStaff = state.role !== 'client'

    for (const profile of Object.values(state.client)) {
      const matches =
        (profile.guest_name ?? '').toLowerCase().includes(needle) ||
        (profile.family_head ?? '').toLowerCase().includes(needle) ||
        (profile.room_number ?? '').toLowerCase().includes(needle)
      if (!matches) continue
      const guestId = profile.guest_id
      if (guestId) seen.add(guestId)
      results.push({ profile, groupId: groupIdForGuest(state, guestId) })
      if (results.length >= limit) return results
    }

    if (!isStaff) return results

    for (const guest of Object.values(state.guests)) {
      if (seen.has(guest.id)) continue
      if (results.length >= limit) break
      const group = state.groups[guest.group_id]
      const phone = guest.mobile ?? group?.primary_mobile ?? ''
      const head = group?.head_name ?? ''
      if (!phone.includes(needle) && !head.toLowerCase().includes(needle)) continue
      results.push({
        // The RPC leg's rows carry no rsvp_status; see the header.
        profile: {
          arrival_date: null,
          arrival_mode: null,
          arrival_point: null,
          arrival_time: null,
          departure_date: null,
          departure_mode: null,
          departure_point: null,
          departure_time: null,
          event_id: state.eventId,
          family_head: group?.head_name ?? null,
          group_type: group?.group_type ?? null,
          guest_id: guest.id,
          guest_name: guest.full_name,
          hamper_delivered: derived(state).hamperDelivered.has(guest.group_id),
          hotel_name: null,
          needs_return_gift: group?.needs_return_gift ?? null,
          pax: group ? headcount(group) : null,
          return_gift_delivered: derived(state).returnGiftDelivered.has(guest.group_id),
          room_number: null,
          rsvp_status: null,
          side: group?.side ?? null,
        },
        groupId: guest.group_id,
      })
    }

    return results
  })
}

const EMPTY_FIND: FindResult[] = []

/** The client directory's rows, straight from the view's own array. */
export function selectClientRows(state: EventState): ClientProfileRow[] {
  return stable('clientRows', [state.client], () => Object.values(state.client))
}

/* ------------------------------------------------------------------ */
/* Today                                                              */
/* ------------------------------------------------------------------ */

export interface TodayNumbers {
  totalGroups: number
  totalPax: number
  rsvpConfirmed: number
  rsvpPending: number
  guestsRoomed: number
  hampersDelivered: number
  hampersPending: number
  arrivalsToday: number
  departuresToday: number
  confirmedNoRoom: number
  arrivalsNoVehicle: number
  noDeparture: number
}

const PENDING_STATUSES = new Set<RsvpStatus>([
  'not_started',
  'attempted',
  'callback',
  'tentative',
])

/**
 * The Today board, from `v_event_board`'s definitions, in JS.
 *
 * `todayKey` IS PASSED IN, NOT READ FROM THE CLOCK, and that is deliberate.
 * The view used the SERVER's `current_date` (Seoul, UTC+9), which rolls over
 * about three and a half hours before the venue's own midnight — so between
 * 20:30 and midnight IST the server already calls tomorrow "today" and the
 * arrivals tile counts the wrong day. The venue's date is what a runner means
 * by "today", so the caller passes the device's local date and the tile is
 * right at the hours that matter. It is also what makes this function testable
 * without freezing the clock.
 */
export function selectTodayNumbers(state: EventState, todayKey: string): TodayNumbers {
  // A client has no board: `v_event_board` is a staff view and the snapshot
  // sends a client none of the tables behind it. Returning the zeroes the
  // screen already handles beats reading empty maps and reporting a confident
  // "0 of 0 families called" on a wedding with 238 of them.
  if (!isStaffSession(state)) return EMPTY_TODAY
  return stable(
    `today:${todayKey}`,
    [state.groups, state.legs, state.trips, state.tripPassengers, state.assignments, state.deliverables],
    () => {
      const index = derived(state)
      const groups = Object.values(state.groups)

      let totalPax = 0
      let rsvpConfirmed = 0
      let rsvpPending = 0
      for (const group of groups) {
        totalPax += group.confirmed_pax ?? group.expected_pax ?? 0
        if (group.rsvp_status === 'confirmed') rsvpConfirmed += 1
        else if (PENDING_STATUSES.has(group.rsvp_status)) rsvpPending += 1
      }

      let hampersDelivered = 0
      let hampersPending = 0
      for (const item of Object.values(state.deliverables)) {
        if (item.kind === 'hamper') {
          if (item.status === 'delivered') hampersDelivered += 1
          else hampersPending += 1
        }
      }

      let arrivalsToday = 0
      let departuresToday = 0
      const arrivalGroupsToday = new Set<string>()
      const groupsWithDepartureLeg = new Set<string>()
      for (const leg of Object.values(state.legs)) {
        if (leg.travel_date === todayKey) {
          if (leg.direction === 'arrival') {
            arrivalsToday += 1
            arrivalGroupsToday.add(leg.group_id)
          } else {
            departuresToday += 1
          }
        }
        if (leg.direction === 'departure') groupsWithDepartureLeg.add(leg.group_id)
      }

      // Arrivals with no vehicle: a family arriving today with no arrival trip
      // they are on. The view's anti-join, over `trip_passengers` joined to a
      // trip whose direction is 'arrival'.
      const arrivalTripIds = new Set(
        Object.values(state.trips)
          .filter((trip) => trip.direction === 'arrival')
          .map((trip) => trip.id),
      )
      const groupsOnArrivalTrip = new Set<string>()
      for (const passenger of Object.values(state.tripPassengers)) {
        if (arrivalTripIds.has(passenger.trip_id)) groupsOnArrivalTrip.add(passenger.group_id)
      }
      let arrivalsNoVehicle = 0
      for (const groupId of arrivalGroupsToday) {
        if (!groupsOnArrivalTrip.has(groupId)) arrivalsNoVehicle += 1
      }

      let confirmedNoRoom = 0
      let noDeparture = 0
      for (const group of groups) {
        if (group.rsvp_status !== 'confirmed') continue
        if (!index.activeAssignmentsByGroup.has(group.id)) confirmedNoRoom += 1
        if (!groupsWithDepartureLeg.has(group.id)) noDeparture += 1
      }

      return {
        totalGroups: groups.length,
        totalPax,
        rsvpConfirmed,
        rsvpPending,
        guestsRoomed: Object.keys(state.assignments).length,
        hampersDelivered,
        hampersPending,
        arrivalsToday,
        departuresToday,
        confirmedNoRoom,
        arrivalsNoVehicle,
        noDeparture,
      }
  })
}

/* ------------------------------------------------------------------ */
/* Ops for the screens' writes                                         */
/* ------------------------------------------------------------------ */

/**
 * The optimistic ops for the writes the job screens perform.
 *
 * Kept here, beside the projections, because an op and a projection have to
 * agree: `optimisticRsvpOutcome` must produce the same queue row that
 * `selectQueueRows` would produce from the server's answer, or the row flickers
 * when the catch-up lands. A factory per write, so a screen's call site reads
 * as one line and the shape lives in one place.
 */
export const optimisticOps = {
  /** A logged RSVP outcome: the group's status/pax, plus the call aggregate. */
  rsvpOutcome(vars: {
    groupId: string
    rsvpStatus: RsvpStatus
    adultsConfirmed: string
    childrenConfirmed: string
    callbackAt: string | null
    outcome: CallOutcome | null
    at: string
  }): StoreOp[] {
    const adults = Number(vars.adultsConfirmed || 0)
    const children = Number(vars.childrenConfirmed || 0)
    const confirmed = adults + children
    return [
      {
        t: 'group.patch',
        id: vars.groupId,
        patch: {
          rsvp_status: vars.rsvpStatus,
          ...(confirmed > 0 ? { confirmed_pax: confirmed } : {}),
        },
      },
      {
        t: 'callStat.bump',
        groupId: vars.groupId,
        at: vars.at,
        outcome: vars.outcome,
        nextCallbackAt: vars.callbackAt,
      },
    ]
  },

  /** A dial that has not closed yet: `count(*)` moves, `last_outcome` goes null. */
  callOpened(vars: { groupId: string; at: string }): StoreOp[] {
    return [
      {
        t: 'callStat.bump',
        groupId: vars.groupId,
        at: vars.at,
        outcome: null,
        nextCallbackAt: null,
        open: true,
      },
    ]
  },

  /** Mark-arrived / mark-departed stamp the leg; the server clock replaces it. */
  legStamped(vars: {
    legIds: readonly string[]
    direction: TravelDirection
    at: string
  }): StoreOp[] {
    return vars.legIds.map((id) =>
      vars.direction === 'arrival'
        ? { t: 'leg.patch' as const, id, patch: { arrived_at: vars.at } }
        : { t: 'leg.patch' as const, id, patch: { departed_at: vars.at } },
    )
  },

  /** Check in / out: a forward-only move on the group's active assignment. */
  stayStamped(vars: { assignmentIds: readonly string[]; at: string; out?: boolean }): StoreOp[] {
    return vars.assignmentIds.map((id) =>
      vars.out
        ? { t: 'assignment.patch' as const, id, patch: { checked_out_at: vars.at } }
        : {
            t: 'assignment.patch' as const,
            id,
            patch: { checked_in_at: vars.at, checked_out_at: null },
          },
    )
  },

  /** A soft release: remove the row from the ACTIVE set (see the reducer). */
  assignmentReleased(vars: { assignmentIds: readonly string[] }): StoreOp[] {
    return vars.assignmentIds.map((id) => ({
      t: 'row.remove' as const,
      key: 'assignments' as const,
      id,
    }))
  },

  /** An optimistic placement with a synthetic id until the server answers. */
  assignmentAdded(row: AssignmentRow): StoreOp[] {
    return [{ t: 'row.set', key: 'assignments', row }]
  },

  /** A generated hamper / return gift. */
  deliverableAdded(row: DeliverableRow): StoreOp[] {
    return [{ t: 'row.set', key: 'deliverables', row }]
  },
}

/**
 * A `room_assignments` row the phone invents, so a placement shows on the board
 * before the server has answered.
 *
 * MOSTLY NULLS, AND THE ID IS MARKED. The id is `pending-<guest>` so nothing can
 * mistake it for a server id: the move and release actions send it back to the
 * server, which will refuse it, and the catch-up replaces it with the real row a
 * moment later. That is the same failure mode the old GridData patch had (it
 * simply did not add occupants at all) with the difference that the occupant is
 * now visible immediately, which is what the person who tapped expects.
 *
 * `released_at: null` is what puts it in the store's ACTIVE assignment map —
 * `setRow` refuses any row with a release stamp (see `reducer.ts`).
 */
export function syntheticAssignmentRow(input: {
  guestId: string
  groupId: string
  roomId: string
  at: string
}): AssignmentRow {
  return {
    id: `pending-${input.guestId}`,
    room_id: input.roomId,
    guest_id: input.guestId,
    group_id: input.groupId,
    assigned_at: input.at,
    assigned_by: null,
    assigned_by_staff: null,
    check_in_date: null,
    check_in_time: null,
    check_out_date: null,
    check_out_time: null,
    checked_in_at: null,
    checked_out_at: null,
    created_at: input.at,
    is_override: false,
    override_reason: null,
    release_reason: null,
    released_at: null,
    updated_at: input.at,
  }
}

/** Confirmed guests of one family that hold no bed right now. */
export function unplacedGuestIds(state: EventState, groupId: string): string[] {
  const index = derived(state)
  if (index.activeAssignmentsByGroup.has(groupId)) {
    const placed = new Set(
      (index.activeAssignmentsByGroup.get(groupId) ?? []).map((row) => row.guest_id),
    )
    return (index.guestsByGroup.get(groupId) ?? [])
      .map((guest) => guest.id)
      .filter((id) => !placed.has(id))
  }
  return (index.guestsByGroup.get(groupId) ?? []).map((guest) => guest.id)
}

/**
 * Place up to `count` of a family's unplaced guests in one room.
 *
 * THE PHONE CANNOT KNOW WHICH GUESTS THE SERVER WILL PICK, and it does not try
 * to. The server's `assignGuestsToRoom` takes the family's unassigned guests in
 * its own order; this takes the first `count` of the same set. When the two
 * disagree the catch-up corrects the names — but the COUNT, the room's free
 * beds and the family's shortfall are right immediately, which is what the
 * screen is read for.
 */
export function optimisticPlaceOps(
  state: EventState,
  vars: { groupId: string; roomId: string; count: number },
  at: string,
): StoreOp[] {
  return unplacedGuestIds(state, vars.groupId)
    .slice(0, Math.max(0, vars.count))
    .map((guestId) =>
      optimisticOps.assignmentAdded(
        syntheticAssignmentRow({ guestId, groupId: vars.groupId, roomId: vars.roomId, at }),
      ),
    )
    .flat()
}

/** Move one assignment to another room — a single-column patch. */
export function optimisticMoveOps(vars: { assignmentId: string; toRoomId: string }): StoreOp[] {
  return [
    { t: 'assignment.patch', id: vars.assignmentId, patch: { room_id: vars.toRoomId } },
  ]
}

/** Take one occupant out: a soft release is the row leaving the active set. */
export function optimisticRemoveOps(vars: { assignmentId: string }): StoreOp[] {
  return optimisticOps.assignmentReleased({ assignmentIds: [vars.assignmentId] })
}

/** Put one waiting guest into a room. */
export function optimisticAddGuestOps(
  state: EventState,
  vars: { guestId: string; roomId: string },
  at: string,
): StoreOp[] {
  const guest = state.guests[vars.guestId]
  if (!guest) return []
  return optimisticOps.assignmentAdded(
    syntheticAssignmentRow({
      guestId: vars.guestId,
      groupId: guest.group_id,
      roomId: vars.roomId,
      at,
    }),
  )
}

/** Where a group's active stay is, for the ops above. */
export function activeAssignmentIds(state: EventState, groupId: string): string[] {
  return (derived(state).activeAssignmentsByGroup.get(groupId) ?? []).map((row) => row.id)
}

/** Every leg id for a group in one direction — mark_arrived stamps them all. */
export function legIdsFor(
  state: EventState,
  groupId: string,
  direction: TravelDirection,
): string[] {
  return (derived(state).legsByGroup.get(groupId)?.[direction] ?? []).map((leg) => leg.id)
}

/** The groups whose room label contains `label` — for ops that need a room. */
export function roomLabelFor(state: EventState, roomId: string): string {
  return derived(state).roomLabelByRoom.get(roomId) ?? ''
}

/** The `side` value the rooms share rule needs. */
export function groupSide(state: EventState, groupId: string): Side | null {
  return state.groups[groupId]?.side ?? null
}