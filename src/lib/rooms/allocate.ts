/**
 * Proposing room allocations.
 *
 * This module PROPOSES. It never writes. Same principle as the RSVP
 * extraction: the algorithm drafts, a human commits.
 *
 * Deliberately greedy — largest group first, within priority order — and not
 * a bin-packing solver. Every placement it makes can be explained in one
 * sentence to the client at 2am, which is worth more here than a few saved
 * beds. Pure and dependency-free so the plan shown on screen is computed by
 * exactly the code that the commit consumes.
 */

export type GroupType = 'family' | 'couple' | 'friends' | 'single'
export type AgeBand = 'adult' | 'child' | 'infant'
export type Side = 'bride' | 'groom' | 'both' | 'other'

export interface AllocGuest {
  id: string
  fullName: string
  ageBand: AgeBand
  isHead: boolean
}

export interface AllocGroup {
  id: string
  headName: string
  groupType: GroupType
  side: Side | null
  priority: number
  /** Guests with no active room assignment. Only these are ever placed. */
  unplacedGuests: AllocGuest[]
  /** How many of this family already hold a room. */
  placedCount: number
  /**
   * The hotel this family is already in, if any. A family never splits
   * across hotels, so a re-run is pinned to wherever the first run put them.
   */
  pinnedHotelId: string | null
  /** Room numbers this family already occupies — used to prefer adjacency. */
  existingRoomNumbers: string[]
}

export interface AllocRoom {
  id: string
  hotelId: string
  hotelName: string
  roomNumber: string
  capacity: number
  /** Capacity minus current active occupants. */
  freeBeds: number
  /** True when the room already holds somebody from another family. */
  occupiedByOthers: boolean
}

// ---------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------

export interface RoomPlacement {
  roomId: string
  roomNumber: string
  hotelId: string
  hotelName: string
  guests: AllocGuest[]
  /** Beds still free in this room after the proposal. */
  bedsLeft: number
}

export interface FamilyPlacement {
  groupId: string
  headName: string
  groupType: GroupType
  side: Side | null
  priority: number
  pax: number
  placedAlready: number
  rooms: RoomPlacement[]
  /** Total unused beds in the rooms proposed for this family. */
  spareBeds: number
  /** Set when the family was split across rooms — allowed, but worth seeing. */
  splitAcrossRooms: boolean
  /** Set when a group containing a child had to be split. */
  childrenSplit: boolean
}

export type UnplacedReason =
  | 'no_capacity_anywhere'
  | 'no_room_large_enough'
  | 'pinned_hotel_full'
  | 'no_rooms_at_all'

export const UNPLACED_LABELS: Record<UnplacedReason, string> = {
  no_capacity_anywhere: 'No free beds left in any hotel',
  no_room_large_enough: 'No single hotel has enough free beds together',
  pinned_hotel_full: 'Their hotel is full and a family cannot split across hotels',
  no_rooms_at_all: 'No rooms have been set up yet',
}

export interface UnplacedFamily {
  groupId: string
  headName: string
  groupType: GroupType
  pax: number
  reason: UnplacedReason
  detail: string
}

/**
 * Two different single guests proposed into one room.
 *
 * Held separately and defaulted OFF at commit time. Auto-committing two
 * strangers into a room is the mistake that reaches the client before it
 * reaches you, so this needs a tick of its own.
 */
export interface ProposedShare {
  roomId: string
  roomNumber: string
  hotelName: string
  side: Side | null
  occupants: { groupId: string; headName: string; guest: AllocGuest }[]
}

export interface AllocationPlan {
  placements: FamilyPlacement[]
  unplaced: UnplacedFamily[]
  shares: ProposedShare[]
  emptyRooms: AllocRoom[]
  summary: {
    familiesPlaced: number
    familiesUnplaced: number
    guestsPlaced: number
    bedsSpare: number
    roomsUsed: number
    roomsEmpty: number
  }
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

/** Numeric-aware distance between room numbers, for adjacency preference. */
function roomDistance(a: string, b: string): number {
  const na = Number(a.replace(/\D/g, ''))
  const nb = Number(b.replace(/\D/g, ''))
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return Number.MAX_SAFE_INTEGER
  return Math.abs(na - nb)
}

function hasChildren(guests: readonly AllocGuest[]): boolean {
  return guests.some((g) => g.ageBand === 'child' || g.ageBand === 'infant')
}

interface WorkingRoom extends AllocRoom {
  /** Mutated as the plan is built. Never written back to the database. */
  remaining: number
  /** Groups proposed into this room during this run. */
  claimedBy: string[]
}

/**
 * Choose rooms within ONE hotel for `need` beds.
 *
 * Exact fill first, then least waste. Rooms nearer the family's existing
 * rooms win ties, so a family that grows stays on the same corridor.
 */
function chooseRooms(
  rooms: WorkingRoom[],
  need: number,
  opts: { exclusive: boolean; nearTo: string[] },
): WorkingRoom[] | null {
  const available = rooms.filter(
    (r) => r.remaining > 0 && (!opts.exclusive || (!r.occupiedByOthers && r.claimedBy.length === 0)),
  )
  if (available.length === 0) return null

  const total = available.reduce((sum, r) => sum + r.remaining, 0)
  if (total < need) return null

  const nearness = (r: WorkingRoom) =>
    opts.nearTo.length === 0
      ? 0
      : Math.min(...opts.nearTo.map((n) => roomDistance(r.roomNumber, n)))

  // 1. A single room that fits exactly is always the best answer.
  const exact = available
    .filter((r) => r.remaining === need)
    .sort((a, b) => nearness(a) - nearness(b))
  if (exact.length > 0) return [exact[0]]

  // 2. A single room that fits with the least waste.
  const fits = available
    .filter((r) => r.remaining > need)
    .sort((a, b) => a.remaining - b.remaining || nearness(a) - nearness(b))
  if (fits.length > 0) return [fits[0]]

  // 3. Several rooms. Take the largest room that does not overshoot what is
  //    still needed — that is what "fill rooms exactly" means in practice —
  //    and only overshoot on the final room, choosing the smallest that can.
  const chosen: WorkingRoom[] = []
  const pool = [...available]
  let remaining = need

  while (remaining > 0 && pool.length > 0) {
    const under = pool
      .filter((r) => r.remaining <= remaining)
      .sort((a, b) => b.remaining - a.remaining || nearness(a) - nearness(b))

    const pick =
      under[0] ??
      pool
        .filter((r) => r.remaining > remaining)
        .sort((a, b) => a.remaining - b.remaining || nearness(a) - nearness(b))[0]

    if (!pick) break
    chosen.push(pick)
    remaining -= Math.min(pick.remaining, remaining)
    pool.splice(pool.indexOf(pick), 1)
  }

  return remaining <= 0 ? chosen : null
}

// ---------------------------------------------------------------------
// The allocator
// ---------------------------------------------------------------------

export function allocateRooms(
  groups: readonly AllocGroup[],
  rooms: readonly AllocRoom[],
): AllocationPlan {
  const working: WorkingRoom[] = rooms.map((r) => ({ ...r, remaining: r.freeBeds, claimedBy: [] }))

  const byHotel = new Map<string, WorkingRoom[]>()
  for (const room of working) {
    const list = byHotel.get(room.hotelId) ?? []
    list.push(room)
    byHotel.set(room.hotelId, list)
  }
  for (const list of byHotel.values()) {
    list.sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }))
  }

  const placements: FamilyPlacement[] = []
  const unplaced: UnplacedFamily[] = []

  // Candidates only: nobody with zero unplaced guests needs anything.
  const queue = groups
    .filter((g) => g.unplacedGuests.length > 0)
    // Priority first — that is how the client says "put my brother in a good
    // room". Then largest first, which is what makes a greedy pass behave:
    // big families are the hard ones to fit and must not be left to the end.
    .sort(
      (a, b) =>
        b.priority - a.priority ||
        b.unplacedGuests.length - a.unplacedGuests.length ||
        a.headName.localeCompare(b.headName),
    )

  for (const group of queue) {
    const need = group.unplacedGuests.length

    if (working.length === 0) {
      unplaced.push({
        groupId: group.id,
        headName: group.headName,
        groupType: group.groupType,
        pax: need,
        reason: 'no_rooms_at_all',
        detail: 'No rooms exist for this event yet.',
      })
      continue
    }

    // A family never splits across hotels. If some of them are already in
    // one, the rest go there or nowhere.
    const hotelIds = group.pinnedHotelId ? [group.pinnedHotelId] : [...byHotel.keys()]

    // Couples get a room to themselves; a group with children should stay in
    // one room where capacity allows.
    const wantsExclusive = group.groupType === 'couple'
    const wantsOneRoom = wantsExclusive || hasChildren(group.unplacedGuests)

    let chosen: WorkingRoom[] | null = null

    for (const pass of wantsOneRoom ? ['single', 'any'] : ['any']) {
      for (const hotelId of hotelIds) {
        const pool = byHotel.get(hotelId) ?? []
        if (pool.length === 0) continue

        if (pass === 'single') {
          // Only accept a one-room answer on this pass.
          const one = chooseRooms(pool, need, {
            exclusive: wantsExclusive,
            nearTo: group.existingRoomNumbers,
          })
          if (one && one.length === 1) {
            chosen = one
            break
          }
          continue
        }

        const any = chooseRooms(pool, need, {
          // A couple that cannot get a room alone still should not be put in
          // with strangers, so exclusivity is kept even on the fallback pass.
          exclusive: wantsExclusive,
          nearTo: group.existingRoomNumbers,
        })
        if (any) {
          chosen = any
          break
        }
      }
      if (chosen) break
    }

    if (!chosen) {
      const totalFree = working.reduce((sum, r) => sum + r.remaining, 0)
      const reason: UnplacedReason = group.pinnedHotelId
        ? 'pinned_hotel_full'
        : totalFree === 0
          ? 'no_capacity_anywhere'
          : 'no_room_large_enough'

      unplaced.push({
        groupId: group.id,
        headName: group.headName,
        groupType: group.groupType,
        pax: need,
        reason,
        detail:
          reason === 'pinned_hotel_full'
            ? `${need} bed${need === 1 ? '' : 's'} needed in the hotel they are already in, and it is full.`
            : reason === 'no_capacity_anywhere'
              ? 'Every room is full.'
              : `${need} beds needed together in one hotel; the free beds are spread across hotels.`,
      })
      continue
    }

    // Hand guests out in the order the rooms were chosen. Which individual
    // sleeps where is not knowable here — member names are collected at
    // allocation anyway — so this is a stable order, not a claim.
    const roomPlacements: RoomPlacement[] = []
    let cursor = 0
    for (const room of chosen) {
      const take = Math.min(room.remaining, need - cursor)
      if (take <= 0) continue
      const guests = group.unplacedGuests.slice(cursor, cursor + take)
      cursor += take

      room.remaining -= take
      room.claimedBy.push(group.id)

      roomPlacements.push({
        roomId: room.id,
        roomNumber: room.roomNumber,
        hotelId: room.hotelId,
        hotelName: room.hotelName,
        guests,
        bedsLeft: room.remaining,
      })
    }

    placements.push({
      groupId: group.id,
      headName: group.headName,
      groupType: group.groupType,
      side: group.side,
      priority: group.priority,
      pax: need,
      placedAlready: group.placedCount,
      rooms: roomPlacements,
      spareBeds: roomPlacements.reduce((sum, r) => sum + r.bedsLeft, 0),
      splitAcrossRooms: roomPlacements.length > 1,
      childrenSplit: hasChildren(group.unplacedGuests) && roomPlacements.length > 1,
    })
  }

  // Rooms this run put more than one DIFFERENT group into. Those are the
  // proposed shares — the only placements that need approving one by one.
  const shares: ProposedShare[] = []
  for (const room of working) {
    const groupsHere = [...new Set(room.claimedBy)]
    if (groupsHere.length < 2) continue

    const occupants = groupsHere.flatMap((groupId) => {
      const placement = placements.find((p) => p.groupId === groupId)
      const inRoom = placement?.rooms.find((r) => r.roomId === room.id)
      return (inRoom?.guests ?? []).map((guest) => ({
        groupId,
        headName: placement?.headName ?? 'Unknown',
        guest,
      }))
    })

    const sides = new Set(
      groupsHere.map((id) => placements.find((p) => p.groupId === id)?.side ?? null),
    )

    shares.push({
      roomId: room.id,
      roomNumber: room.roomNumber,
      hotelName: room.hotelName,
      side: sides.size === 1 ? [...sides][0] : null,
      occupants,
    })
  }

  const emptyRooms: AllocRoom[] = working
    .filter((r) => r.remaining === r.capacity && r.claimedBy.length === 0)
    .map((r) => ({
      id: r.id,
      hotelId: r.hotelId,
      hotelName: r.hotelName,
      roomNumber: r.roomNumber,
      capacity: r.capacity,
      freeBeds: r.freeBeds,
      occupiedByOthers: r.occupiedByOthers,
    }))

  const roomsUsed = new Set(placements.flatMap((p) => p.rooms.map((r) => r.roomId))).size

  return {
    placements,
    unplaced,
    shares,
    emptyRooms,
    summary: {
      familiesPlaced: placements.length,
      familiesUnplaced: unplaced.length,
      guestsPlaced: placements.reduce((n, p) => n + p.pax, 0),
      bedsSpare: working.reduce((n, r) => n + r.remaining, 0),
      roomsUsed,
      roomsEmpty: emptyRooms.length,
    },
  }
}

/**
 * The room ids involved in a proposed share, so the commit can drop them
 * unless the user ticked that share.
 */
export function sharedRoomIds(plan: AllocationPlan): Set<string> {
  return new Set(plan.shares.map((s) => s.roomId))
}
