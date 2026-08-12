/**
 * R2 — room suggestion engine — `src/lib/allocate/suggest.ts`.
 *
 * The invariants under test are the ones the SRS pins to the database:
 * a family NEVER exceeds a room's max_capacity, and a family that does not
 * fit anywhere is flagged for manual multi-room assignment rather than
 * silently split.
 */

import { describe, expect, it } from 'vitest'

import { scoreRoom, suggestRooms, type SuggestGroup, type SuggestRoom } from '@/lib/allocate/suggest'

function room(partial: Partial<SuggestRoom> & { id: string }): SuggestRoom {
  return {
    hotelId: 'h1',
    hotelName: 'Grand Palace',
    roomNumber: '101',
    floor: '1',
    baseCapacity: 2,
    maxCapacity: 3,
    occupied: 0,
    ...partial,
  }
}

function family(occupancy: number, side: SuggestGroup['side'] = 'bride'): SuggestGroup {
  return {
    id: 'g1',
    headName: 'Test Family',
    side,
    occupancy,
    guests: Array.from({ length: occupancy }, (_, i) => ({
      fullName: `Guest ${i}`,
      ageBand: 'adult' as const,
    })),
  }
}

describe('suggestRooms — hard constraints', () => {
  it('never suggests a room whose max_capacity is below the family occupancy', () => {
    const group = family(6)
    const rooms = [
      room({ id: 'r1', maxCapacity: 4, baseCapacity: 4, roomNumber: 'A' }),
      room({ id: 'r2', maxCapacity: 6, baseCapacity: 4, roomNumber: 'B' }),
    ]
    const result = suggestRooms(group, rooms)
    expect(result.suggestions.length).toBe(1)
    expect(result.suggestions[0].room.id).toBe('r2')
    expect(result.suggestions[0].reason).toContain('max 6')
  })

  it('flags a family too large for every room instead of splitting', () => {
    const group = family(6)
    const rooms = [room({ id: 'r1', maxCapacity: 4, baseCapacity: 4 })]
    const result = suggestRooms(group, rooms)
    expect(result.suggestions).toHaveLength(0)
    expect(result.tooLarge).toBe(true)
    expect(result.tooLargeReason).toContain('Assign multiple rooms by hand')
  })

  it('respects a room already partially occupied', () => {
    const group = family(3)
    const rooms = [
      room({ id: 'r1', maxCapacity: 3, baseCapacity: 3, occupied: 1 }), // 2 free — too small
      room({ id: 'r2', maxCapacity: 4, baseCapacity: 4, occupied: 1 }), // 3 free — fits
    ]
    const result = suggestRooms(group, rooms)
    expect(result.suggestions.map((s) => s.room.id)).toEqual(['r2'])
  })
})

describe('suggestRooms — top 3 + reasons', () => {
  it('returns up to 3 suggestions, best first', () => {
    const group = family(2)
    const rooms = [
      room({ id: 'r1', roomNumber: '1', maxCapacity: 2, baseCapacity: 2 }),
      room({ id: 'r2', roomNumber: '2', maxCapacity: 3, baseCapacity: 3 }),
      room({ id: 'r3', roomNumber: '3', maxCapacity: 4, baseCapacity: 4 }),
      room({ id: 'r4', roomNumber: '4', maxCapacity: 5, baseCapacity: 5 }),
    ]
    const result = suggestRooms(group, rooms)
    expect(result.suggestions).toHaveLength(3)
    // The 2-capacity room fits exactly with no waste — highest score.
    expect(result.suggestions[0].room.id).toBe('r1')
  })

  it('gives every suggestion a human-readable reason, never a bare score', () => {
    const group = family(2)
    const result = suggestRooms(group, [room({ id: 'r1', roomNumber: '101', maxCapacity: 2, baseCapacity: 2 })])
    expect(result.suggestions[0].reason).toMatch(/Room 101/)
    expect(result.suggestions[0].reason).toMatch(/fits without an extra bed/)
    // The score is internal — the reason must stand on its own.
    expect(result.suggestions[0].reason).not.toContain('+100')
  })

  it('prefers base-capacity fit (comfort) over a bigger room', () => {
    const group = family(2)
    const rooms = [
      room({ id: 'big', roomNumber: 'B', maxCapacity: 6, baseCapacity: 6 }), // 4 beds wasted
      room({ id: 'fit', roomNumber: 'A', maxCapacity: 2, baseCapacity: 2 }), // exact fit
    ]
    const result = suggestRooms(group, rooms)
    expect(result.suggestions[0].room.id).toBe('fit')
  })
})

describe('scoreRoom — reason strings', () => {
  it('mentions the extra bed when base capacity is exceeded', () => {
    const group = family(3)
    const r = room({ id: 'r1', maxCapacity: 4, baseCapacity: 2 })
    const suggestion = scoreRoom(group, r)
    expect(suggestion).not.toBeNull()
    expect(suggestion!.reason).toContain('extra bed')
  })

  it('names the side when clustering applies', () => {
    const group = family(2, 'groom')
    const suggestion = scoreRoom(group, room({ id: 'r1', maxCapacity: 2, baseCapacity: 2 }))
    expect(suggestion!.reason).toContain("groom's side")
  })

  it('returns null when the hard capacity constraint is violated', () => {
    const group = family(5)
    const r = room({ id: 'r1', maxCapacity: 4, baseCapacity: 4 })
    expect(scoreRoom(group, r)).toBeNull()
  })
})
