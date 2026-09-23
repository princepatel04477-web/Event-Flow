/**
 * The allocator — the ONE room-planning algorithm in this app.
 *
 * It PROPOSES. Nothing here touches the database: the board renders the
 * proposal, a human accepts or skips each family, and `commitRoomPlan` is the
 * only thing that writes. Same principle as the RSVP review screen.
 *
 * FOUR GUEST TYPES drive it, as the brief asks (Prince's Brief, Phase 2):
 * family, couple, single, friends. The type is DERIVED from the family's own
 * numbers rather than trusted from the spreadsheet column, because the column
 * is what a caller typed at 11pm and the numbers are what the room has to hold
 * — see `deriveGuestType`.
 *
 * WHY THIS FILE AND NOT `src/lib/rooms/allocate.ts`. There were two allocators
 * in the repo. `src/lib/rooms/allocate.ts` was never imported by anything and
 * has been removed; this one is on the v1 allocate screen's import path, so it
 * is the one that had to become correct. Its better ideas — pinned hotels,
 * plain-language unplaced reasons, proposed shares as a separate list — were
 * folded in here rather than left in a file nobody called.
 *
 * DETERMINISTIC. Every sort carries a full tiebreaker chain ending in an id, so
 * the same input always produces byte-identical output. A planner who runs the
 * proposal twice and sees two different answers stops trusting it, and there is
 * no way to earn that back during an event.
 *
 * NEVER OVER CAPACITY. Beds are counted against `rooms.capacity`, never
 * `max_capacity`. The extra-bed ceiling exists, but the database demands an
 * explicit override reason to use it (`app.guard_room_capacity`), and a machine
 * cannot write that reason honestly.
 */

// ---------------------------------------------------------------------------
// Input types — what the allocator needs from the database
// ---------------------------------------------------------------------------

/** The four guest types from the brief. */
export type GuestType = 'family' | 'couple' | 'friends' | 'single'

/**
 * A guest's gender, when it is known.
 *
 * `guests` has NO gender column today, so in this app it is always null and the
 * pairing rule below degrades to "same side only". It is modelled anyway
 * because the rule the brief states is "two singles of the same side (and
 * gender if known)", and a rule that cannot express its own condition is a rule
 * that quietly gets dropped when the column arrives.
 */
export type Gender = 'male' | 'female' | null

export interface GuestForAllocation {
  id: string
  group_id: string
  is_head: boolean
  age_band: 'adult' | 'child' | 'infant'
  gender?: Gender
}

export interface GroupForAllocation {
  id: string
  headName: string
  groupType: 'family' | 'couple' | 'friends' | 'single'
  side: 'bride' | 'groom' | 'both' | 'other' | null
  expectedPax: number
  confirmedPax: number | null
  priority: number
  /** Guests already in this group, including the head. */
  guests: GuestForAllocation[]
  /**
   * Room ids this group already holds — ONE ENTRY PER ACTIVE ASSIGNMENT, so
   * the length is the number of people already in a bed (the same room id
   * appears twice when two of them share it). `readAllocationData` builds it
   * that way; the allocator relies on it for both the headcount still to place
   * and the hotel this family is pinned to.
   */
  existingRoomIds: string[]
  /** A single's gender, when known. See `Gender`. */
  gender?: Gender
}

export interface RoomForAllocation {
  id: string
  hotelId: string
  hotelName: string
  roomNumber: string
  /** Beds in the room. The planning ceiling — never `max_capacity`. */
  capacity: number
  /** Beds already occupied by active assignments (existing placements). */
  occupiedBeds: number
  /** Beds currently free. Recomputed from capacity; the passed value is advisory. */
  freeBeds: number
  /** Floor label, for same/adjacent-floor preference when a family splits. */
  floor?: string | null
  /** Extra-bed ceiling. Carried for the UI; the allocator never plans into it. */
  maxCapacity?: number
  /** Out of service. Skipped entirely. */
  isBlocked?: boolean
}

// ---------------------------------------------------------------------------
// Output types — what the allocator returns
// ---------------------------------------------------------------------------

export interface RoomProposal {
  roomId: string
  hotelName: string
  roomNumber: string
  /** Floor label, so the review line can say "2nd floor". */
  floor: string | null
  /** How many of this group's pax are proposed for this room. */
  paxInRoom: number
  /** Beds left after this and any existing occupants. */
  bedsRemaining: number
  /** Whether this room is adjacent to the previous one proposed for this group. */
  adjacentToPrevious: boolean
  /** Whether this room is already held by the group (existing assignment). */
  alreadyHeld: boolean
  /** This room also takes another single in this same plan. */
  shared: boolean
}

export interface ProposedGroup {
  groupId: string
  headName: string
  side: 'bride' | 'groom' | 'both' | 'other' | null
  groupType: 'family' | 'couple' | 'friends' | 'single'
  /** The DERIVED type the rules actually used. See `deriveGuestType`. */
  guestType: GuestType
  /** Total pax to place (confirmedPax ?? expectedPax, minus already-placed). */
  paxToPlace: number
  /** Rooms proposed for this group. */
  rooms: RoomProposal[]
  /** The group was placed (all pax covered). */
  placed: boolean
  /** One line a staff member reads to decide whether to accept this row. */
  reason: string
  /** The plan puts this family in more than one room. */
  splitAcrossRooms: boolean
  /** The plan puts this single in a room with another single. */
  shared: boolean
  /**
   * Why it could not be placed, if not placed. Null if placed or if the
   * reason cannot be determined precisely.
   */
  failureReason: string | null
}

export interface ProposedShare {
  groupIds: string[]
  headNames: string[]
  side: 'bride' | 'groom' | 'both' | 'other' | null
  roomId: string
  hotelName: string
  roomNumber: string
}

export interface EmptyRoom {
  roomId: string
  hotelName: string
  roomNumber: string
  capacity: number
  freeBeds: number
}

export interface AllocationResult {
  /** Groups this plan places. */
  placed: ProposedGroup[]
  /** Groups that could not be placed. */
  unplaced: ProposedGroup[]
  /** Proposed shares between different single guests. */
  proposedShares: ProposedShare[]
  /** Rooms left completely empty. */
  emptyRooms: EmptyRoom[]
  /** Summary numbers. */
  summary: {
    familiesPlaced: number
    familiesUnplaced: number
    guestsPlaced: number
    bedsSpare: number
    roomsUsed: number
    totalRooms: number
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const paxOf = (g: GroupForAllocation): number => g.confirmedPax ?? g.expectedPax
const childCount = (guests: readonly GuestForAllocation[]): number =>
  guests.filter((r) => r.age_band === 'child' || r.age_band === 'infant').length

/** The numeric part of a room number, for adjacency and ordering. */
function roomOrdinal(roomNumber: string): number | null {
  const digits = roomNumber.replace(/\D/g, '')
  if (digits.length === 0) return null
  const n = Number(digits)
  return Number.isFinite(n) ? n : null
}

/** Is this room adjacent to the previous one we proposed for this group? */
function isAdjacent(a: string | undefined, b: string): boolean {
  if (a === undefined) return false
  const an = roomOrdinal(a)
  const bn = roomOrdinal(b)
  if (an === null || bn === null) return false
  return Math.abs(an - bn) === 1
}

/**
 * Which of the four types the rules treat this group as.
 *
 * DERIVED, not read off `group_type`. The column is set by whoever imported the
 * sheet or took the call; the headcount is the thing a room has to hold. A
 * group marked "couple" that confirmed six people is a family, and planning it
 * as a couple is how six people end up with two beds.
 *
 * The one column that IS trusted is `friends`: "these six are friends, not a
 * family" is a fact about the people, and nothing in the numbers can express
 * it.
 */
export function deriveGuestType(group: GroupForAllocation): GuestType {
  if (group.groupType === 'friends') return 'friends'

  const pax = paxOf(group)
  // No headcount at all: the column is the only thing left to go on.
  if (!Number.isFinite(pax) || pax <= 0) return group.groupType
  if (pax === 1) return 'single'
  if (childCount(group.guests) > 0) return 'family'
  // Two people who are not flagged as friends are a couple — the friends flag
  // was already returned above, so there is nothing else two adults can be.
  if (pax === 2) return 'couple'
  return 'family'
}

/** Two singles may share only when nothing known about them says otherwise. */
export function singlesMayShare(
  a: { side: GroupForAllocation['side']; gender?: Gender },
  b: { side: GroupForAllocation['side']; gender?: Gender },
): boolean {
  // An unknown side is not a match — pairing two strangers because neither has
  // a side recorded is exactly the mistake that reaches the client first.
  if (a.side === null || b.side === null) return false
  if (a.side !== b.side) return false
  const ga = a.gender ?? null
  const gb = b.gender ?? null
  if (ga !== null && gb !== null && ga !== gb) return false
  return true
}

interface WorkingRoom {
  room: RoomForAllocation
  /** Beds still free in this plan. Never negative. */
  remaining: number
  /** Distinct group ids this plan has put into the room. */
  claimedBy: string[]
  /** Set when a single claims the room and leaves a bed for another single. */
  pairSide: GroupForAllocation['side']
  pairGender: Gender
}

function floorKey(room: RoomForAllocation): string {
  return (room.floor ?? '').trim()
}

/** Deterministic room order: floor, then room number numerically, then id. */
function compareRooms(a: WorkingRoom, b: WorkingRoom): number {
  const fa = floorKey(a.room)
  const fb = floorKey(b.room)
  if (fa !== fb) return fa.localeCompare(fb, undefined, { numeric: true })
  const na = roomOrdinal(a.room.roomNumber)
  const nb = roomOrdinal(b.room.roomNumber)
  if (na !== null && nb !== null && na !== nb) return na - nb
  const byNumber = a.room.roomNumber.localeCompare(b.room.roomNumber, undefined, { numeric: true })
  if (byNumber !== 0) return byNumber
  return a.room.id.localeCompare(b.room.id)
}

/** How far this room is from the rooms the family already holds. */
function nearness(room: WorkingRoom, nearTo: readonly string[]): number {
  if (nearTo.length === 0) return 0
  let best = Number.MAX_SAFE_INTEGER
  for (const other of nearTo) {
    const a = roomOrdinal(room.room.roomNumber)
    const b = roomOrdinal(other)
    if (a === null || b === null) continue
    best = Math.min(best, Math.abs(a - b))
  }
  return best
}

interface ChooseOptions {
  /** No other group may be in the room — couples and families that fit. */
  exclusive: boolean
  /** Room numbers this family already holds, for adjacency. */
  nearTo: readonly string[]
}

/**
 * Pick rooms inside ONE hotel for `need` beds, fewest rooms first and tightest
 * fit inside that.
 *
 * The order matters and is the whole algorithm:
 *   1. one room that fits exactly — no waste, no split
 *   2. one room that fits with the least waste
 *   3. several rooms ON ONE FLOOR, largest first so the count is minimal
 *   4. several rooms anywhere in the hotel, same rule
 *
 * Returns null when this hotel cannot hold them, which is what pushes the
 * search on to the next hotel (or to an unplaced row with a reason).
 */
function chooseRooms(
  pool: readonly WorkingRoom[],
  need: number,
  opts: ChooseOptions,
): WorkingRoom[] | null {
  const usable = pool.filter(
    (r) => r.remaining > 0 && (!opts.exclusive || (r.claimedBy.length === 0 && r.room.occupiedBeds === 0)),
  )
  if (usable.length === 0) return null
  if (usable.reduce((sum, r) => sum + r.remaining, 0) < need) return null

  const near = (r: WorkingRoom) => nearness(r, opts.nearTo)

  // 1 — exact fit.
  const exact = usable
    .filter((r) => r.remaining === need)
    .sort((a, b) => near(a) - near(b) || compareRooms(a, b))
  if (exact.length > 0) return [exact[0]]

  // 2 — one room, least waste.
  const roomy = usable
    .filter((r) => r.remaining > need)
    .sort((a, b) => a.remaining - b.remaining || near(a) - near(b) || compareRooms(a, b))
  if (roomy.length > 0) return [roomy[0]]

  // 3 — one floor, fewest rooms.
  const floors = [...new Set(usable.map((r) => floorKey(r.room)))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  )
  for (const floor of floors) {
    const onFloor = usable.filter((r) => floorKey(r.room) === floor)
    const packed = packFewest(onFloor, need, near)
    if (packed) return packed
  }

  // 4 — anywhere in the hotel.
  return packFewest(usable, need, near)
}

/**
 * Fewest rooms for `need` beds: biggest room first.
 *
 * Biggest-first is what minimises the room COUNT, which is the rule the brief
 * states ("split across the fewest rooms"). It is deliberately not the
 * least-waste choice — a family of seven in a 4 + 3 is two rooms and one wasted
 * bed; picking tightest-first would hand them 2 + 2 + 3 and one more door key.
 */
function packFewest(
  pool: readonly WorkingRoom[],
  need: number,
  near: (r: WorkingRoom) => number,
): WorkingRoom[] | null {
  const ordered = [...pool].sort(
    (a, b) => b.remaining - a.remaining || near(a) - near(b) || compareRooms(a, b),
  )
  const chosen: WorkingRoom[] = []
  let remaining = need
  for (const room of ordered) {
    if (remaining <= 0) break
    chosen.push(room)
    remaining -= room.remaining
  }
  return remaining <= 0 ? chosen : null
}

// ---------------------------------------------------------------------------
// The allocator
// ---------------------------------------------------------------------------

/**
 * Build a room allocation proposal. Pure function — no side effects, no
 * database writes, no clock.
 *
 * Rules, in the order they are applied:
 *   1. highest priority first, then the biggest families (greedy passes that
 *      leave the hard cases till last do not fit them at all)
 *   2. a family already in a hotel stays in that hotel
 *   3. a family goes in ONE room when one fits; otherwise the fewest rooms in
 *      the same hotel, same or adjacent floor
 *   4. couples get a two-bed room of their own where one exists
 *   5. a single shares only with another single of the same side (and gender
 *      when known), and the share is flagged for a human to confirm
 *   6. friends stay together, tightest fit
 *   7. blocked rooms are never offered, and nothing is ever planned past
 *      `capacity`
 */
export function allocate(
  groups: GroupForAllocation[],
  rooms: RoomForAllocation[],
): AllocationResult {
  const working: WorkingRoom[] = rooms
    .filter((r) => r.isBlocked !== true)
    .map((r) => ({
      room: r,
      remaining: Math.max(0, r.capacity - r.occupiedBeds),
      claimedBy: [],
      pairSide: null,
      pairGender: null,
    }))

  const byHotel = new Map<string, WorkingRoom[]>()
  for (const wr of working) {
    const list = byHotel.get(wr.room.hotelId) ?? []
    list.push(wr)
    byHotel.set(wr.room.hotelId, list)
  }
  for (const list of byHotel.values()) list.sort(compareRooms)

  const hotelOrder = [...byHotel.keys()].sort((a, b) => {
    const an = byHotel.get(a)?.[0]?.room.hotelName ?? ''
    const bn = byHotel.get(b)?.[0]?.room.hotelName ?? ''
    return an.localeCompare(bn) || a.localeCompare(b)
  })

  const roomsById = new Map(working.map((wr) => [wr.room.id, wr]))

  // Priority first, then the biggest need, then name, then id. Every step has
  // a tiebreaker so two runs of the same data cannot disagree.
  const queue = [...groups].sort(
    (a, b) =>
      b.priority - a.priority ||
      needOf(b) - needOf(a) ||
      a.headName.localeCompare(b.headName) ||
      a.id.localeCompare(b.id),
  )

  const placed: ProposedGroup[] = []
  const unplaced: ProposedGroup[] = []

  for (const group of queue) {
    const need = needOf(group)
    // Everyone in this family already has a bed. Not a row on anyone's screen:
    // there is nothing to accept and nothing to skip.
    if (need <= 0) continue

    const guestType = deriveGuestType(group)
    const pinnedHotels = [
      ...new Set(
        group.existingRoomIds
          .map((id) => roomsById.get(id)?.room.hotelId)
          .filter((id): id is string => id !== undefined),
      ),
    ].sort()
    const existingRoomNumbers = group.existingRoomIds
      .map((id) => roomsById.get(id)?.room.roomNumber)
      .filter((n): n is string => n !== undefined)

    const hotels = pinnedHotels.length > 0 ? pinnedHotels : hotelOrder

    const chosen = choosePlacement(group, guestType, need, hotels, byHotel, existingRoomNumbers)

    if (chosen === null) {
      unplaced.push(
        unplacedRow(group, guestType, need, working, pinnedHotels.length > 0),
      )
      continue
    }

    // Hand the beds out. `remaining` is decremented HERE and nowhere else — the
    // previous version subtracted inside the packer and again in this loop, so
    // every multi-room family silently ate twice the beds it was given.
    const proposals: RoomProposal[] = []
    let cursor = need
    for (const wr of chosen.rooms) {
      if (cursor <= 0) break
      const take = Math.min(cursor, wr.remaining)
      if (take <= 0) continue
      cursor -= take
      wr.remaining -= take
      if (!wr.claimedBy.includes(group.id)) wr.claimedBy.push(group.id)

      const previous = proposals.length > 0 ? proposals[proposals.length - 1].roomNumber : undefined
      proposals.push({
        roomId: wr.room.id,
        hotelName: wr.room.hotelName,
        roomNumber: wr.room.roomNumber,
        floor: wr.room.floor ?? null,
        paxInRoom: take,
        bedsRemaining: wr.remaining,
        adjacentToPrevious: isAdjacent(previous, wr.room.roomNumber),
        alreadyHeld: false,
        shared: chosen.shared,
      })

      // A single who leaves a bed behind opens the room to one more single of
      // the same side. Anyone else closes it — a family does not acquire a
      // stranger because a bed was spare.
      if (guestType === 'single' && wr.remaining > 0) {
        wr.pairSide = group.side
        wr.pairGender = group.gender ?? null
      } else if (guestType !== 'single') {
        wr.pairSide = null
        wr.pairGender = null
      }
    }

    placed.push({
      groupId: group.id,
      headName: group.headName,
      side: group.side,
      groupType: group.groupType,
      guestType,
      paxToPlace: need,
      rooms: proposals,
      placed: true,
      reason: placementReason(guestType, need, proposals, chosen.shared),
      splitAcrossRooms: proposals.length > 1,
      shared: chosen.shared,
      failureReason: null,
    })
  }

  // Shares: rooms this plan put two DIFFERENT groups into. Held separately
  // because they are the only placements a human must tick one by one.
  const proposedShares: ProposedShare[] = []
  for (const wr of working) {
    if (wr.claimedBy.length < 2) continue
    const members = wr.claimedBy
      .map((id) => placed.find((p) => p.groupId === id))
      .filter((p): p is ProposedGroup => p !== undefined)
    if (members.length < 2) continue
    // Both halves of a share are flagged, not just the one that arrived
    // second. The review row for the FIRST single has to say "sharing" too, or
    // a staff member accepts it believing that guest gets a room alone.
    for (const member of members) {
      member.shared = true
      for (const proposal of member.rooms) {
        if (proposal.roomId === wr.room.id) proposal.shared = true
      }
      member.reason = placementReason(member.guestType, member.paxToPlace, member.rooms, true)
    }
    const sides = new Set(members.map((m) => m.side))
    proposedShares.push({
      groupIds: members.map((m) => m.groupId),
      headNames: members.map((m) => m.headName),
      side: sides.size === 1 ? members[0].side : null,
      roomId: wr.room.id,
      hotelName: wr.room.hotelName,
      roomNumber: wr.room.roomNumber,
    })
  }

  const emptyRooms: EmptyRoom[] = working
    .filter((wr) => wr.claimedBy.length === 0 && wr.room.occupiedBeds === 0)
    .map((wr) => ({
      roomId: wr.room.id,
      hotelName: wr.room.hotelName,
      roomNumber: wr.room.roomNumber,
      capacity: wr.room.capacity,
      freeBeds: wr.remaining,
    }))

  const guestsPlaced = placed.reduce(
    (sum, g) => sum + g.rooms.reduce((n, r) => n + r.paxInRoom, 0),
    0,
  )

  return {
    placed,
    unplaced,
    proposedShares,
    emptyRooms,
    summary: {
      familiesPlaced: placed.length,
      familiesUnplaced: unplaced.length,
      guestsPlaced,
      bedsSpare: working.reduce((sum, wr) => sum + wr.remaining, 0),
      roomsUsed: new Set(placed.flatMap((g) => g.rooms.map((r) => r.roomId))).size,
      totalRooms: rooms.length,
    },
  }
}

function needOf(group: GroupForAllocation): number {
  return Math.max(0, paxOf(group) - group.existingRoomIds.length)
}

interface Placement {
  rooms: WorkingRoom[]
  shared: boolean
}

/**
 * Apply the per-type rules and return the best placement across every hotel
 * this family may use.
 *
 * EVERY hotel is costed, not just the first that fits. Taking the first
 * workable hotel meant a family of seven landed in four two-bed rooms because
 * that hotel sorted first alphabetically, while the 4 + 3 next door went
 * unused — four room keys, four doors to knock on with a hamper, for an
 * alphabetical accident. Fewest rooms wins, then least wasted beds, then hotel
 * order so the answer is still deterministic.
 */
function choosePlacement(
  group: GroupForAllocation,
  guestType: GuestType,
  need: number,
  hotels: readonly string[],
  byHotel: Map<string, WorkingRoom[]>,
  nearTo: readonly string[],
): Placement | null {
  // Rule 5 — a single takes a bed left by another single before opening a new
  // room. Checked across every candidate hotel first, because pairing is worth
  // more than staying in the first hotel in the list.
  if (guestType === 'single' && need === 1) {
    const pairable: WorkingRoom[] = []
    for (const hotelId of hotels) {
      for (const wr of byHotel.get(hotelId) ?? []) {
        if (wr.remaining < 1) continue
        if (wr.claimedBy.length === 0) continue
        if (!singlesMayShare({ side: wr.pairSide, gender: wr.pairGender }, group)) continue
        pairable.push(wr)
      }
    }
    if (pairable.length > 0) {
      pairable.sort((a, b) => a.remaining - b.remaining || compareRooms(a, b))
      return { rooms: [pairable[0]], shared: true }
    }
  }

  // Rule 4 — a couple wants a two-bed room of its own, in any hotel that has
  // one free. Checked before the general search so a two-bed room is never
  // passed over for a tighter-looking corner of a bigger one.
  if (guestType === 'couple') {
    const twoBed: WorkingRoom[] = []
    for (const hotelId of hotels) {
      for (const wr of byHotel.get(hotelId) ?? []) {
        if (wr.room.capacity !== 2) continue
        if (wr.remaining < need) continue
        if (wr.claimedBy.length > 0 || wr.room.occupiedBeds > 0) continue
        twoBed.push(wr)
      }
    }
    if (twoBed.length > 0) {
      twoBed.sort((a, b) => nearness(a, nearTo) - nearness(b, nearTo) || compareRooms(a, b))
      return { rooms: [twoBed[0]], shared: false }
    }
  }

  // Rules 3 and 6 — a room of their own, tightest fit, then the fewest rooms
  // in one hotel. `exclusive` keeps couples and singles out of a room that
  // already holds somebody else.
  const exclusive = guestType === 'couple' || guestType === 'single'
  let best: { placement: Placement; rank: number; waste: number; order: number } | null = null

  for (let order = 0; order < hotels.length; order += 1) {
    const pool = byHotel.get(hotels[order]) ?? []
    if (pool.length === 0) continue

    // NO FALLBACK INTO A STRANGER'S ROOM for a couple or a single. Rule 5 is
    // that a single shares with another single; dropping either of them into
    // whatever family happened to leave a bed spare is the placement that
    // reaches the client before it reaches you, and it is not one a machine
    // should make silently. An unplaced row carrying the reason is the honest
    // answer, and the board's Place sheet still does it by hand in two taps.
    // Families and friends DO take partly-filled rooms — at 238 families the
    // beds that are left are mostly the odd ones, and refusing them would fail
    // the families this screen exists for.
    const candidate = chooseRooms(pool, need, { exclusive, nearTo })
    if (!candidate) continue

    const waste = candidate.reduce((sum, wr) => sum + wr.remaining, 0) - need
    if (
      best === null ||
      candidate.length < best.rank ||
      (candidate.length === best.rank && waste < best.waste) ||
      (candidate.length === best.rank && waste === best.waste && order < best.order)
    ) {
      best = { placement: { rooms: candidate, shared: false }, rank: candidate.length, waste, order }
    }
  }

  return best?.placement ?? null
}

/** The one line the review row shows for a family this plan places. */
function placementReason(
  guestType: GuestType,
  need: number,
  rooms: readonly RoomProposal[],
  shared: boolean,
): string {
  const people = `${need} ${need === 1 ? 'guest' : 'guests'}`
  if (rooms.length === 0) return `${people} — nothing to place.`

  const first = rooms[0]
  if (rooms.length === 1) {
    const where = `${first.hotelName} room ${first.roomNumber}`
    if (shared) return `${people} sharing ${where} with another single, same side.`
    if (guestType === 'couple') {
      return first.bedsRemaining === 0
        ? `Couple in ${where} — a two-bed room to themselves.`
        : `Couple in ${where}, ${first.bedsRemaining} bed${first.bedsRemaining === 1 ? '' : 's'} spare.`
    }
    const fillVerb = need === 1 ? 'fills' : 'fill'
    return first.bedsRemaining === 0
      ? `${people} ${fillVerb} ${where} exactly.`
      : `${people} in ${where}, ${first.bedsRemaining} bed${first.bedsRemaining === 1 ? '' : 's'} spare.`
  }

  const sameFloor = rooms.every((r) => (r.floor ?? '') === (first.floor ?? ''))
  const numbers = rooms.map((r) => r.roomNumber).join(' + ')
  const where = `${first.hotelName} rooms ${numbers}`
  const adjacency = rooms.slice(1).every((r) => r.adjacentToPrevious)
    ? ' — next door to each other'
    : sameFloor && (first.floor ?? '') !== ''
      ? ` — all on ${first.floor}`
      : ''
  return `${people} split across ${rooms.length} rooms in ${where}${adjacency}.`
}

/** A family the plan cannot place, with the reason in plain words. */
function unplacedRow(
  group: GroupForAllocation,
  guestType: GuestType,
  need: number,
  working: readonly WorkingRoom[],
  pinned: boolean,
): ProposedGroup {
  const totalFree = working.reduce((sum, wr) => sum + wr.remaining, 0)
  const largest = working.reduce((max, wr) => Math.max(max, wr.remaining), 0)

  let failureReason: string
  if (working.length === 0) {
    failureReason = 'No rooms have been added to this event yet.'
  } else if (totalFree === 0) {
    failureReason = 'Every room is full.'
  } else if (totalFree < need) {
    failureReason = `Not enough beds left — ${need} needed, ${totalFree} free in the whole event.`
  } else if (pinned) {
    failureReason = `Their hotel has no room for the other ${need}, and a family does not split across hotels.`
  } else if (guestType === 'couple' || guestType === 'single') {
    failureReason = `No free room can take ${need === 1 ? 'them' : 'both of them'} — the ${totalFree} free beds are in rooms other families already hold.`
  } else {
    failureReason = `${need} beds are needed together in one hotel; the largest free room holds ${largest} and the rest are spread out.`
  }

  return {
    groupId: group.id,
    headName: group.headName,
    side: group.side,
    groupType: group.groupType,
    guestType,
    paxToPlace: need,
    rooms: [],
    placed: false,
    reason: failureReason,
    splitAcrossRooms: false,
    shared: false,
    failureReason,
  }
}
