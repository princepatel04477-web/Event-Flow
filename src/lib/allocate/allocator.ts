/**
 * The allocator — greedy, largest-group-first, one hotel per family.
 *
 * Produces a PROPOSAL only. Nothing here touches the database; it is a pure
 * function the preview screen calls, and the user commits separately.
 */

// ---------------------------------------------------------------------------
// Input types — what the allocator needs from the database
// ---------------------------------------------------------------------------

export interface GuestForAllocation {
  id: string
  group_id: string
  is_head: boolean
  age_band: 'adult' | 'child' | 'infant'
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
  /** Room assignments the group already holds (active, unreleased). */
  existingRoomIds: string[]
}

export interface RoomForAllocation {
  id: string
  hotelId: string
  hotelName: string
  roomNumber: string
  capacity: number
  /** Beds already occupied by active assignments (existing placements). */
  occupiedBeds: number
  /** Beds currently free (computed: capacity - occupiedBeds). Mutated during allocation. */
  freeBeds: number
}

// ---------------------------------------------------------------------------
// Output types — what the allocator returns
// ---------------------------------------------------------------------------

export interface RoomProposal {
  roomId: string
  hotelName: string
  roomNumber: string
  /** How many of this group's pax are proposed for this room. */
  paxInRoom: number
  /** Beds left after this and any existing occupants. */
  bedsRemaining: number
  /** Whether this room is adjacent to the previous one proposed for this group. */
  adjacentToPrevious: boolean
  /** Whether this room is already held by the group (existing assignment). */
  alreadyHeld: boolean
}

export interface ProposedGroup {
  groupId: string
  headName: string
  side: 'bride' | 'groom' | 'both' | 'other' | null
  groupType: 'family' | 'couple' | 'friends' | 'single'
  /** Total pax to place (confirmedPax ?? expectedPax, minus already-placed). */
  paxToPlace: number
  /** Rooms proposed for this group. */
  rooms: RoomProposal[]
  /** The group was placed (all pax covered). */
  placed: boolean
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
  /** Groups successfully placed. */
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
    bedsSpare: number
    totalRooms: number
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const pax = (g: GroupForAllocation): number => g.confirmedPax ?? g.expectedPax
const kids = (g: GuestForAllocation[]): GuestForAllocation[] =>
  g.filter((r) => r.age_band === 'child' || r.age_band === 'infant')
const adultsOnly = (g: GuestForAllocation[]): GuestForAllocation[] => g.filter((r) => r.age_band === 'adult')

/** Is this room adjacent to the previous one we proposed for this group? */
function isAdjacent(a: string | undefined, b: string): boolean {
  if (!a) return false
  const an = parseInt(a, 10)
  const bn = parseInt(b, 10)
  if (isNaN(an) || isNaN(bn)) return false
  return Math.abs(an - bn) === 1
}

// ---------------------------------------------------------------------------
// The allocator
// ---------------------------------------------------------------------------

/**
 * Build a room allocation proposal. Pure function — no side effects, no
 * database writes.
 *
 * Rules applied in priority order:
 *   g) Highest priority groups allocate first
 *   a) One family → one hotel (can split across rooms in same hotel)
 *   b) Fill rooms exactly where possible
 *   c) Couples get their own room
 *   d) Singles of same side MAY share — proposed only
 *   e) Friends groups stay together
 *   f) Groups with children stay in one room where capacity allows
 *
 * Re-running safety:
 *   - Already-placed guests are subtracted from paxToPlace and never moved
 *   - Hotels already touched by a group constrain hotel choice
 */
export function allocate(
  groups: GroupForAllocation[],
  rooms: RoomForAllocation[],
): AllocationResult {
  // Sort: highest priority first
  const sorted = [...groups].sort((a, b) => b.priority - a.priority)

  // Copy rooms and track remaining capacity
  const available = rooms.map((r) => ({ ...r, freeBeds: r.capacity - r.occupiedBeds }))
  const hotelIndex = new Map<string, typeof available>()
  for (const r of available) {
    const list = hotelIndex.get(r.hotelId) ?? []
    list.push(r)
    hotelIndex.set(r.hotelId, list)
  }

  const placed: ProposedGroup[] = []
  const unplaced: ProposedGroup[] = []
  const shares: ProposedShare[] = []

  for (const group of sorted) {
    // P1: subtract already-placed guests
    const totalPax = pax(group)
    const alreadyPlaced = group.existingRoomIds.length
    const remainingPax = Math.max(0, totalPax - alreadyPlaced)

    if (remainingPax === 0) {
      placed.push({
        groupId: group.id,
        headName: group.headName,
        side: group.side,
        groupType: group.groupType,
        paxToPlace: 0,
        rooms: group.existingRoomIds.map(() => ({
          roomId: '',
          hotelName: '',
          roomNumber: '',
          paxInRoom: 0,
          bedsRemaining: 0,
          adjacentToPrevious: false,
          alreadyHeld: true,
        })),
        placed: true,
        failureReason: null,
      })
      continue
    }

    // P1: determine hotel constraint — if already in a hotel, stay there
    const existingHotelIds = new Set(
      group.existingRoomIds
        .map((rid) => rooms.find((r) => r.id === rid)?.hotelId)
        .filter((id): id is string => id !== undefined),
    )

    const result = allocateGroup(group, remainingPax, available, hotelIndex, existingHotelIds)

    if (result.placed) {
      placed.push(result)
      // Consume rooms
      for (const pr of result.rooms) {
        if (pr.alreadyHeld) continue
        const room = available.find((r) => r.id === pr.roomId)
        if (room) room.freeBeds -= pr.paxInRoom
      }
    } else {
      unplaced.push(result)
    }
  }

  // Detect proposed shares (singles proposed to share)
  const singleRooms = new Map<string, ProposedGroup[]>()
  for (const pg of placed) {
    if (pg.groupType !== 'single') continue
    for (const r of pg.rooms) {
      const key = r.roomId
      if (!singleRooms.has(key)) singleRooms.set(key, [])
      singleRooms.get(key)!.push(pg)
    }
  }
  for (const [roomId, groupsInRoom] of singleRooms) {
    if (groupsInRoom.length < 2) continue
    const room = rooms.find((r) => r.id === roomId)
    if (!room) continue
    shares.push({
      groupIds: groupsInRoom.map((g) => g.groupId),
      headNames: groupsInRoom.map((g) => g.headName),
      side: groupsInRoom[0].side,
      roomId,
      hotelName: room.hotelName,
      roomNumber: room.roomNumber,
    })
  }

  // Empty rooms
  const emptyRooms: EmptyRoom[] = available
    .filter((r) => r.freeBeds === r.capacity)
    .map((r) => ({
      roomId: r.id,
      hotelName: r.hotelName,
      roomNumber: r.roomNumber,
      capacity: r.capacity,
      freeBeds: r.freeBeds,
    }))

  const totalBeds = rooms.reduce((s, r) => s + r.capacity - r.occupiedBeds, 0)
  const usedBeds = placed.reduce(
    (s, g) => s + g.rooms.filter((r) => !r.alreadyHeld).reduce((t, rr) => t + rr.paxInRoom, 0),
    0,
  )

  return {
    placed,
    unplaced,
    proposedShares: shares,
    emptyRooms,
    summary: {
      familiesPlaced: placed.filter((g) => g.placed).length,
      familiesUnplaced: unplaced.length,
      bedsSpare: totalBeds - usedBeds,
      totalRooms: rooms.length,
    },
  }
}

// ---------------------------------------------------------------------------
// Per-group allocation (pure)
// ---------------------------------------------------------------------------

function allocateGroup(
  group: GroupForAllocation,
  remainingPax: number,
  available: RoomForAllocation[],
  hotelIndex: Map<string, RoomForAllocation[]>,
  existingHotelIds: Set<string>,
): ProposedGroup {
  const need = remainingPax

  // Determine candidate hotels
  let candidateHotels: string[]
  if (existingHotelIds.size > 0) {
    candidateHotels = [...existingHotelIds]
  } else {
    candidateHotels = [...hotelIndex.keys()]
  }

  // Try each hotel — first one that fits wins
  for (const hotelId of candidateHotels) {
    const hotelRooms = (hotelIndex.get(hotelId) ?? [])
      .filter((r) => r.freeBeds > 0)
      .sort((a, b) => {
        // Sort by room number for adjacency preference
        const an = parseInt(a.roomNumber, 10)
        const bn = parseInt(b.roomNumber, 10)
        if (!isNaN(an) && !isNaN(bn)) return an - bn
        return a.roomNumber.localeCompare(b.roomNumber)
      })

    const result = tryAllocation(group, need, hotelRooms)
    if (result) {
      return {
        groupId: group.id,
        headName: group.headName,
        side: group.side,
        groupType: group.groupType,
        paxToPlace: need,
        rooms: result,
        placed: true,
        failureReason: null,
      }
    }
  }

  // Could not place — figure out why
  let failureReason: string
  const totalFree = available.reduce((s, r) => s + r.freeBeds, 0)
  const maxRoomCapacity = Math.max(...available.filter((r) => r.freeBeds > 0).map((r) => r.freeBeds), 0)

  if (totalFree < need) {
    failureReason = `Not enough beds (need ${need}, only ${totalFree} free across all hotels)`
  } else if (need > maxRoomCapacity && group.groupType === 'family') {
    failureReason = `No single room large enough for ${need} people (largest free room has ${maxRoomCapacity} beds)`
  } else if (existingHotelIds.size > 0) {
    const hotelFree = available.filter((r) => existingHotelIds.has(r.hotelId)).reduce((s, r) => s + r.freeBeds, 0)
    failureReason = `Already in a hotel with only ${hotelFree} free beds (need ${need})`
  } else {
    failureReason = `Could not fit ${need} people across available rooms`
  }

  return {
    groupId: group.id,
    headName: group.headName,
    side: group.side,
    groupType: group.groupType,
    paxToPlace: need,
    rooms: [],
    placed: false,
    failureReason,
  }
}

// ---------------------------------------------------------------------------
// Room allocation for one group in one hotel
// ---------------------------------------------------------------------------

function tryAllocation(
  group: GroupForAllocation,
  need: number,
  hotelRooms: RoomForAllocation[],
): RoomProposal[] | null {
  const proposals: RoomProposal[] = []
  let remaining = need

  // Rule (c): Couples get their own room
  if (group.groupType === 'couple') {
    if (need > 1) return null // couple with PAX > 2 is unusual but should not happen
    const room = hotelRooms.find((r) => r.freeBeds >= need)
    if (!room) return null
    proposals.push({
      roomId: room.id,
      hotelName: room.hotelName,
      roomNumber: room.roomNumber,
      paxInRoom: need,
      bedsRemaining: room.freeBeds - need,
      adjacentToPrevious: false,
      alreadyHeld: false,
    })
    return proposals
  }

  // Rule (f): Groups with children try to stay in one room
  if (kids(group.guests).length > 0) {
    const bigEnough = hotelRooms.find((r) => r.freeBeds >= need)
    if (bigEnough) {
      proposals.push({
        roomId: bigEnough.id,
        hotelName: bigEnough.hotelName,
        roomNumber: bigEnough.roomNumber,
        paxInRoom: need,
        bedsRemaining: bigEnough.freeBeds - need,
        adjacentToPrevious: false,
        alreadyHeld: false,
      })
      return proposals
    }
    // Falls through to multi-room — children will split across rooms
  }

  // Rule (e): Friends groups keep together — try to fill rooms fully
  if (group.groupType === 'friends') {
    return packGreedy(need, hotelRooms, proposals)
  }

  // Rule (d): Singles
  if (group.groupType === 'single') {
    const room = hotelRooms.find((r) => r.freeBeds >= need)
    if (!room) return null
    proposals.push({
      roomId: room.id,
      hotelName: room.hotelName,
      roomNumber: room.roomNumber,
      paxInRoom: need,
      bedsRemaining: room.freeBeds - need,
      adjacentToPrevious: false,
      alreadyHeld: false,
    })
    return proposals
  }

  // Rule (b): Fill rooms exactly — family allocation, general case
  return packGreedy(need, hotelRooms, proposals)
}

/** Greedy bin-packing: largest fitting room first, adjacency preferred. */
function packGreedy(
  need: number,
  rooms: RoomForAllocation[],
  proposals: RoomProposal[],
): RoomProposal[] | null {
  let remaining = need
  const result = [...proposals]

  // Sort: prefer rooms that fit exactly, then by size desc for adjacency
  const sorted = [...rooms].sort((a, b) => {
    const aExact = a.freeBeds === remaining ? 0 : 1
    const bExact = b.freeBeds === remaining ? 0 : 1
    if (aExact !== bExact) return aExact - bExact
    return b.freeBeds - a.freeBeds
  })

  for (const room of sorted) {
    if (room.freeBeds <= 0) continue
    if (remaining <= 0) break

    const take = Math.min(remaining, room.freeBeds)
    const prevRoomNumber = result.length > 0 ? result[result.length - 1].roomNumber : undefined

    result.push({
      roomId: room.id,
      hotelName: room.hotelName,
      roomNumber: room.roomNumber,
      paxInRoom: take,
      bedsRemaining: room.freeBeds - take,
      adjacentToPrevious: isAdjacent(prevRoomNumber, room.roomNumber),
      alreadyHeld: false,
    })
    remaining -= take
    room.freeBeds -= take // mutate local copy
  }

  return remaining <= 0 ? result : null
}
