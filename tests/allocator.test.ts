/**
 * The room allocator — `src/lib/allocate/allocator.ts`.
 *
 * These are the rules the brief states (Prince's Brief, Phase 2) and the ones
 * the database enforces underneath. Each test is one sentence a coordinator
 * would recognise: keep a family together, give a couple a double, pair two
 * singles of the same side, never hand out a bed that does not exist.
 *
 * Pure input, pure output — no Supabase, no clock, no DOM.
 */

import { describe, expect, it } from 'vitest'

import {
  allocate,
  deriveGuestType,
  singlesMayShare,
  type GroupForAllocation,
  type GuestForAllocation,
  type RoomForAllocation,
} from '@/lib/allocate/allocator'

// ---------------------------------------------------------------------------
// Builders — keep every test to the two or three facts it is about
// ---------------------------------------------------------------------------

function guests(
  groupId: string,
  adults: number,
  children = 0,
): GuestForAllocation[] {
  const rows: GuestForAllocation[] = []
  for (let i = 0; i < adults; i += 1) {
    rows.push({ id: `${groupId}-a${i}`, group_id: groupId, is_head: i === 0, age_band: 'adult' })
  }
  for (let i = 0; i < children; i += 1) {
    rows.push({ id: `${groupId}-c${i}`, group_id: groupId, is_head: false, age_band: 'child' })
  }
  return rows
}

function group(partial: Partial<GroupForAllocation> & { id: string }): GroupForAllocation {
  const pax = partial.confirmedPax ?? partial.expectedPax ?? 1
  return {
    headName: `Family ${partial.id}`,
    groupType: 'family',
    side: 'bride',
    expectedPax: pax,
    confirmedPax: null,
    priority: 0,
    guests: guests(partial.id, pax),
    existingRoomIds: [],
    ...partial,
  }
}

function room(partial: Partial<RoomForAllocation> & { id: string }): RoomForAllocation {
  const capacity = partial.capacity ?? 2
  const occupied = partial.occupiedBeds ?? 0
  return {
    hotelId: 'h1',
    hotelName: 'Grand Palace',
    roomNumber: partial.id,
    floor: '1',
    capacity,
    occupiedBeds: occupied,
    freeBeds: capacity - occupied,
    ...partial,
  }
}

/** Every bed this plan hands out, per room. */
function bedsTaken(result: ReturnType<typeof allocate>): Map<string, number> {
  const taken = new Map<string, number>()
  for (const family of result.placed) {
    for (const proposal of family.rooms) {
      taken.set(proposal.roomId, (taken.get(proposal.roomId) ?? 0) + proposal.paxInRoom)
    }
  }
  return taken
}

// ---------------------------------------------------------------------------

describe('deriveGuestType', () => {
  it('reads the four types off the headcount, not off the spreadsheet column', () => {
    expect(deriveGuestType(group({ id: 'g1', expectedPax: 1 }))).toBe('single')
    expect(deriveGuestType(group({ id: 'g2', expectedPax: 2 }))).toBe('couple')
    expect(deriveGuestType(group({ id: 'g3', expectedPax: 5 }))).toBe('family')
  })

  it('treats two adults with a child as a family, never a couple', () => {
    const g = group({ id: 'g4', expectedPax: 3, guests: guests('g4', 2, 1) })
    expect(deriveGuestType(g)).toBe('family')
  })

  it('trusts the friends flag, because no headcount can express it', () => {
    expect(deriveGuestType(group({ id: 'g5', groupType: 'friends', expectedPax: 4 }))).toBe('friends')
    expect(deriveGuestType(group({ id: 'g6', groupType: 'friends', expectedPax: 2 }))).toBe('friends')
  })

  it('corrects a column that disagrees with the confirmed headcount', () => {
    // The caller ticked "couple" and then heard six people were coming.
    const g = group({ id: 'g7', groupType: 'couple', expectedPax: 2, confirmedPax: 6 })
    expect(deriveGuestType(g)).toBe('family')
  })
})

describe('a family that fits one room goes in one room', () => {
  it('puts all six in the one room that holds six', () => {
    const result = allocate(
      [group({ id: 'g1', expectedPax: 6 })],
      [
        room({ id: '101', capacity: 2 }),
        room({ id: '102', capacity: 6 }),
        room({ id: '103', capacity: 8 }),
      ],
    )

    expect(result.placed).toHaveLength(1)
    expect(result.placed[0].rooms).toHaveLength(1)
    expect(result.placed[0].rooms[0].roomId).toBe('102')
    expect(result.placed[0].rooms[0].paxInRoom).toBe(6)
    expect(result.placed[0].splitAcrossRooms).toBe(false)
  })

  it('prefers the exact fit over the roomier one, so no bed is wasted', () => {
    const result = allocate(
      [group({ id: 'g1', expectedPax: 4 })],
      [room({ id: '201', capacity: 6 }), room({ id: '202', capacity: 4 })],
    )
    expect(result.placed[0].rooms[0].roomId).toBe('202')
    expect(result.placed[0].rooms[0].bedsRemaining).toBe(0)
  })
})

describe('a family too big for one room splits into the fewest rooms, same hotel', () => {
  const sevenRooms: RoomForAllocation[] = [
    // The alphabetically-first hotel can hold them, but only in four rooms.
    room({ id: 'b1', hotelId: 'h2', hotelName: 'Aster Inn', capacity: 2 }),
    room({ id: 'b2', hotelId: 'h2', hotelName: 'Aster Inn', capacity: 2 }),
    room({ id: 'b3', hotelId: 'h2', hotelName: 'Aster Inn', capacity: 2 }),
    room({ id: 'b4', hotelId: 'h2', hotelName: 'Aster Inn', capacity: 2 }),
    // Two rooms next door to each other in the other hotel.
    room({ id: '301', hotelId: 'h1', hotelName: 'Grand Palace', capacity: 4 }),
    room({ id: '302', hotelId: 'h1', hotelName: 'Grand Palace', capacity: 3 }),
  ]

  it('takes 4 + 3 in one hotel rather than four rooms in another', () => {
    const result = allocate([group({ id: 'g1', expectedPax: 7 })], sevenRooms)

    const family = result.placed[0]
    expect(family.rooms).toHaveLength(2)
    expect(family.rooms.map((r) => r.roomId).sort()).toEqual(['301', '302'])
    expect(new Set(family.rooms.map((r) => r.hotelName)).size).toBe(1)
    expect(family.rooms.reduce((n, r) => n + r.paxInRoom, 0)).toBe(7)
    expect(family.splitAcrossRooms).toBe(true)
  })

  it('never splits one family across two hotels', () => {
    const result = allocate(
      [group({ id: 'g1', expectedPax: 7 })],
      [
        room({ id: '401', hotelId: 'h1', hotelName: 'Grand Palace', capacity: 4 }),
        room({ id: 'b1', hotelId: 'h2', hotelName: 'Aster Inn', capacity: 4 }),
      ],
    )

    expect(result.placed).toHaveLength(0)
    expect(result.unplaced).toHaveLength(1)
    expect(result.unplaced[0].failureReason).toContain('one hotel')
  })

  it('keeps a family in the hotel it is already in', () => {
    const rooms: RoomForAllocation[] = [
      room({ id: '501', hotelId: 'h1', hotelName: 'Grand Palace', capacity: 2, occupiedBeds: 2 }),
      room({ id: '502', hotelId: 'h1', hotelName: 'Grand Palace', capacity: 3 }),
      room({ id: 'b9', hotelId: 'h2', hotelName: 'Aster Inn', capacity: 8 }),
    ]
    const result = allocate(
      // Two of five are already in 501, so three beds are still needed.
      [group({ id: 'g1', expectedPax: 5, existingRoomIds: ['501', '501'] })],
      rooms,
    )

    expect(result.placed[0].paxToPlace).toBe(3)
    expect(result.placed[0].rooms[0].roomId).toBe('502')
  })

  it('prefers rooms on one floor when it has to split', () => {
    const result = allocate(
      [group({ id: 'g1', expectedPax: 6 })],
      [
        room({ id: '101', floor: '1', capacity: 3 }),
        room({ id: '201', floor: '2', capacity: 3 }),
        room({ id: '202', floor: '2', capacity: 3 }),
      ],
    )
    const floors = new Set(result.placed[0].rooms.map((r) => r.floor))
    expect(floors).toEqual(new Set(['2']))
  })
})

describe('a couple gets a two-bed room', () => {
  it('chooses the double over a bigger room with space', () => {
    const result = allocate(
      [group({ id: 'g1', groupType: 'couple', expectedPax: 2 })],
      [room({ id: '601', capacity: 4 }), room({ id: '602', capacity: 2 })],
    )

    expect(result.placed[0].guestType).toBe('couple')
    expect(result.placed[0].rooms[0].roomId).toBe('602')
    expect(result.placed[0].rooms[0].bedsRemaining).toBe(0)
  })

  it('never puts a couple into a room somebody else already holds', () => {
    const result = allocate(
      [group({ id: 'g1', groupType: 'couple', expectedPax: 2 })],
      [room({ id: '701', capacity: 4, occupiedBeds: 2 })],
    )
    // The two free beds are in a room another family holds — the couple stays
    // unplaced with a reason rather than being moved in with strangers.
    expect(result.placed).toHaveLength(0)
    expect(result.unplaced[0].failureReason).toContain('other families already hold')
  })
})

describe('two singles of the same side are paired, and the pairing is flagged', () => {
  it('puts both in one two-bed room and marks it shared', () => {
    const result = allocate(
      [
        group({ id: 's1', groupType: 'single', expectedPax: 1, side: 'bride', headName: 'Asha' }),
        group({ id: 's2', groupType: 'single', expectedPax: 1, side: 'bride', headName: 'Bindu' }),
      ],
      [room({ id: '801', capacity: 2 }), room({ id: '802', capacity: 2 })],
    )

    expect(result.placed).toHaveLength(2)
    const roomIds = new Set(result.placed.flatMap((p) => p.rooms.map((r) => r.roomId)))
    expect(roomIds.size).toBe(1)

    // BOTH halves say "shared" — the first single's row must not read as a
    // room to themselves.
    expect(result.placed.every((p) => p.shared)).toBe(true)
    expect(result.placed.every((p) => p.rooms.every((r) => r.shared))).toBe(true)

    expect(result.proposedShares).toHaveLength(1)
    expect(result.proposedShares[0].headNames.sort()).toEqual(['Asha', 'Bindu'])
    expect(result.proposedShares[0].side).toBe('bride')
  })

  it('does not pair two singles from opposite sides', () => {
    const result = allocate(
      [
        group({ id: 's1', groupType: 'single', expectedPax: 1, side: 'bride' }),
        group({ id: 's2', groupType: 'single', expectedPax: 1, side: 'groom' }),
      ],
      [room({ id: '901', capacity: 2 }), room({ id: '902', capacity: 2 })],
    )

    const rooms = result.placed.flatMap((p) => p.rooms.map((r) => r.roomId))
    expect(new Set(rooms).size).toBe(2)
    expect(result.proposedShares).toHaveLength(0)
  })

  it('does not pair two singles whose genders are known and differ', () => {
    expect(singlesMayShare({ side: 'bride', gender: 'male' }, { side: 'bride', gender: 'female' })).toBe(false)
    expect(singlesMayShare({ side: 'bride', gender: 'male' }, { side: 'bride', gender: null })).toBe(true)
    expect(singlesMayShare({ side: null }, { side: null })).toBe(false)

    const result = allocate(
      [
        group({ id: 's1', groupType: 'single', expectedPax: 1, side: 'bride', gender: 'male' }),
        group({ id: 's2', groupType: 'single', expectedPax: 1, side: 'bride', gender: 'female' }),
      ],
      [room({ id: '911', capacity: 2 }), room({ id: '912', capacity: 2 })],
    )
    expect(result.proposedShares).toHaveLength(0)
  })
})

describe('the hard constraints', () => {
  it('skips a blocked room entirely', () => {
    const result = allocate(
      [group({ id: 'g1', expectedPax: 4 })],
      [
        room({ id: 'X1', capacity: 4, isBlocked: true }),
        room({ id: 'X2', capacity: 6 }),
      ],
    )

    expect(result.placed[0].rooms[0].roomId).toBe('X2')
    expect(result.emptyRooms.map((r) => r.roomId)).not.toContain('X1')
  })

  it('leaves a family unplaced rather than use a blocked room', () => {
    const result = allocate(
      [group({ id: 'g1', expectedPax: 4 })],
      [room({ id: 'X1', capacity: 4, isBlocked: true })],
    )
    expect(result.placed).toHaveLength(0)
    expect(result.unplaced).toHaveLength(1)
  })

  it('never hands out more beds than a room has, across many families', () => {
    const rooms = [
      room({ id: '101', capacity: 4 }),
      room({ id: '102', capacity: 3, occupiedBeds: 1 }),
      room({ id: '103', capacity: 2 }),
    ]
    const result = allocate(
      [
        group({ id: 'g1', expectedPax: 4 }),
        group({ id: 'g2', expectedPax: 2 }),
        group({ id: 'g3', expectedPax: 2, groupType: 'couple' }),
        group({ id: 'g4', expectedPax: 3 }),
      ],
      rooms,
    )

    const taken = bedsTaken(result)
    for (const r of rooms) {
      const free = r.capacity - r.occupiedBeds
      expect(taken.get(r.id) ?? 0).toBeLessThanOrEqual(free)
    }
    // And the total handed out never exceeds the beds that existed.
    const totalFree = rooms.reduce((n, r) => n + (r.capacity - r.occupiedBeds), 0)
    expect(result.summary.guestsPlaced).toBeLessThanOrEqual(totalFree)
  })

  it('counts an existing occupant, so the second family gets the remainder only', () => {
    const result = allocate(
      [group({ id: 'g1', expectedPax: 2 })],
      [room({ id: '101', capacity: 4, occupiedBeds: 3 })],
    )
    // Only one bed is free; two people cannot go in, and nothing is forced.
    expect(result.placed).toHaveLength(0)
    expect(result.unplaced[0].failureReason).toContain('Not enough beds')
  })

  it('plans against capacity, never the extra-bed ceiling', () => {
    const result = allocate(
      [group({ id: 'g1', expectedPax: 4 })],
      [room({ id: '101', capacity: 3, maxCapacity: 5 })],
    )
    expect(result.placed).toHaveLength(0)
    expect(result.unplaced).toHaveLength(1)
  })

  it('leaves a family that is already fully placed off both lists', () => {
    const result = allocate(
      [group({ id: 'g1', expectedPax: 2, existingRoomIds: ['101', '101'] })],
      [room({ id: '101', capacity: 2, occupiedBeds: 2 })],
    )
    expect(result.placed).toHaveLength(0)
    expect(result.unplaced).toHaveLength(0)
  })
})

describe('the plan is deterministic', () => {
  const rooms: RoomForAllocation[] = [
    room({ id: '101', capacity: 2 }),
    room({ id: '102', capacity: 4 }),
    room({ id: '103', capacity: 3, floor: '2' }),
    room({ id: 'b1', hotelId: 'h2', hotelName: 'Aster Inn', capacity: 5 }),
    room({ id: 'b2', hotelId: 'h2', hotelName: 'Aster Inn', capacity: 2 }),
  ]
  const families: GroupForAllocation[] = [
    group({ id: 'g1', expectedPax: 4 }),
    group({ id: 'g2', expectedPax: 2, groupType: 'couple' }),
    group({ id: 'g3', expectedPax: 1, groupType: 'single', side: 'groom' }),
    group({ id: 'g4', expectedPax: 1, groupType: 'single', side: 'groom' }),
    group({ id: 'g5', expectedPax: 5 }),
  ]

  it('gives the identical answer twice', () => {
    const a = allocate(families, rooms)
    const b = allocate(families, rooms)
    expect(JSON.stringify(b)).toBe(JSON.stringify(a))
  })

  it('does not depend on the order the families arrive in', () => {
    const forwards = allocate(families, rooms)
    const backwards = allocate([...families].reverse(), rooms)

    const byGroup = (result: ReturnType<typeof allocate>) =>
      [...result.placed]
        .sort((x, y) => x.groupId.localeCompare(y.groupId))
        .map((p) => `${p.groupId}:${p.rooms.map((r) => `${r.roomId}x${r.paxInRoom}`).join(',')}`)

    expect(byGroup(backwards)).toEqual(byGroup(forwards))
  })

  it('does not mutate the rooms it was given', () => {
    const snapshot = JSON.stringify(rooms)
    allocate(families, rooms)
    expect(JSON.stringify(rooms)).toBe(snapshot)
  })
})

describe('every row carries a reason a person can read', () => {
  it('explains a single-room placement', () => {
    const result = allocate(
      [group({ id: 'g1', expectedPax: 4, headName: 'Sharma' })],
      [room({ id: '101', capacity: 4 })],
    )
    expect(result.placed[0].reason).toBe('4 guests fill Grand Palace room 101 exactly.')
  })

  it('uses correct singular grammar for 1 guest', () => {
    const result = allocate(
      [group({ id: 'g1', expectedPax: 1, headName: 'Verma', groupType: 'friends' })],
      [room({ id: '101', capacity: 1 })],
    )
    expect(result.placed[0].reason).toBe('1 guest fills Grand Palace room 101 exactly.')
  })

  it('explains a split', () => {
    const result = allocate(
      [group({ id: 'g1', expectedPax: 7 })],
      [room({ id: '101', capacity: 4 }), room({ id: '102', capacity: 3 })],
    )
    expect(result.placed[0].reason).toContain('split across 2 rooms')
    expect(result.placed[0].reason).toContain('next door')
  })

  it('explains a share', () => {
    const result = allocate(
      [
        group({ id: 's1', groupType: 'single', expectedPax: 1, side: 'bride' }),
        group({ id: 's2', groupType: 'single', expectedPax: 1, side: 'bride' }),
      ],
      [room({ id: '101', capacity: 2 })],
    )
    expect(result.placed[0].reason).toContain('sharing')
    expect(result.placed[1].reason).toContain('another single')
  })
})
