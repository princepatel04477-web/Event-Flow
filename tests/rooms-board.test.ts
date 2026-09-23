/**
 * The Rooms board's pure parts — `src/lib/rooms/board.ts`.
 *
 * Three things that mislead silently rather than break: the header line's
 * counts, a search that misses a match, and a floor grouping that sorts room 9
 * after room 10.
 */

import { describe, expect, it } from 'vitest'

import {
  bedsLabel,
  boardSummary,
  compareRoomNumbers,
  groupRoomsByHotelFloor,
  matchesTerm,
  waitingLabel,
} from '@/lib/rooms/board'

describe('boardSummary', () => {
  it('says the state of the world in one line', () => {
    expect(
      boardSummary({
        confirmedGuests: 465,
        guestsWithBed: 312,
        bedsFree: 41,
        familiesWaiting: 14,
      }),
    ).toBe('312 of 465 guests have a bed · 41 beds free · 14 families waiting')
  })

  it('says everyone is placed rather than "0 families waiting"', () => {
    expect(
      boardSummary({ confirmedGuests: 6, guestsWithBed: 6, bedsFree: 2, familiesWaiting: 0 }),
    ).toBe('6 of 6 guests have a bed · 2 beds free · everyone is placed')
  })

  it('reads correctly for one of everything', () => {
    expect(
      boardSummary({ confirmedGuests: 1, guestsWithBed: 0, bedsFree: 1, familiesWaiting: 1 }),
    ).toBe('0 of 1 guest has a bed · 1 bed free · 1 family waiting')
  })
})

describe('matchesTerm', () => {
  it('matches case-insensitively, anywhere in the field', () => {
    expect(matchesTerm('sharma', 'Rajesh Sharma')).toBe(true)
    expect(matchesTerm('  SHARMA ', 'Rajesh Sharma')).toBe(true)
    expect(matchesTerm('101', null, 101)).toBe(true)
  })

  it('matches everything on an empty term', () => {
    expect(matchesTerm('', 'anything')).toBe(true)
    expect(matchesTerm('   ', null)).toBe(true)
  })

  it('does not match a missing field', () => {
    expect(matchesTerm('sharma', null, undefined)).toBe(false)
  })
})

describe('compareRoomNumbers', () => {
  it('puts 9 before 10', () => {
    expect(['10', '9', '101'].sort(compareRoomNumbers)).toEqual(['9', '10', '101'])
  })

  it('handles letter prefixes', () => {
    expect(['A102', 'A9', 'A10'].sort(compareRoomNumbers)).toEqual(['A9', 'A10', 'A102'])
  })
})

describe('groupRoomsByHotelFloor', () => {
  const rooms = [
    { hotelId: 'h2', hotelName: 'Aster Inn', roomNumber: '10', floor: '1' },
    { hotelId: 'h1', hotelName: 'Grand Palace', roomNumber: '201', floor: '2' },
    { hotelId: 'h1', hotelName: 'Grand Palace', roomNumber: '9', floor: '1' },
    { hotelId: 'h1', hotelName: 'Grand Palace', roomNumber: '101', floor: '1' },
    { hotelId: 'h1', hotelName: 'Grand Palace', roomNumber: '7', floor: null },
  ]

  it('groups by hotel, then by floor, in natural order', () => {
    const grouped = groupRoomsByHotelFloor(rooms)

    expect(grouped.map((h) => h.hotelName)).toEqual(['Aster Inn', 'Grand Palace'])

    const grand = grouped[1]
    expect(grand.roomCount).toBe(4)
    expect(grand.floors.map((f) => f.label)).toEqual(['Floor 1', 'Floor 2', 'Floor not recorded'])
    expect(grand.floors[0].rooms.map((r) => r.roomNumber)).toEqual(['9', '101'])
  })

  it('leaves the unlabelled floor last, not first', () => {
    const grouped = groupRoomsByHotelFloor(rooms)
    const last = grouped[1].floors[grouped[1].floors.length - 1]
    expect(last.floor).toBe('')
    expect(last.rooms.map((r) => r.roomNumber)).toEqual(['7'])
  })

  it('keeps a hotel written floor label as the hotel wrote it', () => {
    const grouped = groupRoomsByHotelFloor([
      { hotelId: 'h1', hotelName: 'Grand Palace', roomNumber: 'G1', floor: 'Ground' },
    ])
    expect(grouped[0].floors[0].label).toBe('Ground')
  })
})

describe('row labels', () => {
  it('counts beds', () => {
    expect(bedsLabel(2, 3)).toBe('2 of 3 beds')
    expect(bedsLabel(0, 1)).toBe('0 of 1 bed')
  })

  it('says what a waiting family still needs', () => {
    expect(waitingLabel(6, 0)).toBe('6 guests · no room yet')
    expect(waitingLabel(6, 2)).toBe('6 guests · 2 placed, 4 to go')
    expect(waitingLabel(1, 0)).toBe('1 guest · no room yet')
  })
})
