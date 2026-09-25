import { describe, it, expect } from 'vitest'

import {
  activeRoomFilterCount,
  filterRooms,
  matchesRoomFilters,
  NO_ROOM_FILTERS,
  occupancyStatus,
  roomFilterCounts,
  toggleInList,
  venueValue,
  withVenue,
  type RoomFilterable,
  type RoomFilters,
} from '@/lib/rooms/filters'
import {
  readStoredVenue,
  venueStorageKey,
  writeStoredVenue,
  type VenueStorage,
} from '@/lib/rooms/venue'

/**
 * The Rooms board's filter arithmetic.
 *
 * WHY THIS FILE EXISTS. A filter that is subtly wrong does not throw — it
 * quietly hides a room from the one screen a coordinator trusts to show every
 * room. The three failures pinned here are the ones that read as working:
 * a blocked room miscounted as empty, a facet count that collapses to zero
 * when a sibling chip is on, and a status that disagrees with the squares on
 * the card because it rounded a 3-bed suite with 3 guests to "partly".
 */

function room(over: Partial<RoomFilterable> & { hotelId: string }): RoomFilterable {
  return {
    roomType: 'standard',
    capacity: 2,
    occupied: 0,
    ...over,
  }
}

const GRID: RoomFilterable[] = [
  // Grand Ashoka — 2 standard, 1 suite, 1 deluxe
  room({ hotelId: 'h1', roomType: 'standard', occupied: 0 }), // empty
  room({ hotelId: 'h1', roomType: 'standard', occupied: 2 }), // full
  room({ hotelId: 'h1', roomType: 'suite', capacity: 3, occupied: 0 }), // empty
  room({ hotelId: 'h1', roomType: 'deluxe', occupied: 1 }), // partly
  // Sea View — 1 king, 1 queen
  room({ hotelId: 'h2', roomType: 'king', occupied: 1 }), // partly
  room({ hotelId: 'h2', roomType: 'queen', occupied: 2 }), // full
]

describe('occupancy from bed counts', () => {
  it('reads empty, partly filled and full', () => {
    expect(occupancyStatus(room({ hotelId: 'h', occupied: 0 }))).toBe('empty')
    expect(occupancyStatus(room({ hotelId: 'h', occupied: 1 }))).toBe('partly')
    expect(occupancyStatus(room({ hotelId: 'h', occupied: 2, capacity: 2 }))).toBe('full')
  })

  it('treats a single-occupant room as full, not partly', () => {
    // The bug this guards: `occupied / capacity < 1` with integer rounding calls
    // a 1-of-1 room "partly", and the board then paints a single bed red only
    // on some screens. Occupied >= capacity is the only full test.
    expect(occupancyStatus(room({ hotelId: 'h', capacity: 1, occupied: 1 }))).toBe('full')
  })

  it('treats a three-bed suite with three guests as full', () => {
    expect(occupancyStatus(room({ hotelId: 'h', capacity: 3, occupied: 3 }))).toBe('full')
  })
})

describe('matching', () => {
  it('passes everything when nothing is selected', () => {
    expect(matchesRoomFilters(GRID[0], NO_ROOM_FILTERS)).toBe(true)
  })

  it('folds case when matching a stored room type', () => {
    const filters: RoomFilters = { ...NO_ROOM_FILTERS, types: ['deluxe'] }
    expect(matchesRoomFilters(room({ hotelId: 'h', roomType: 'Deluxe' }), filters)).toBe(true)
    expect(matchesRoomFilters(room({ hotelId: 'h', roomType: 'STANDARD' }), filters)).toBe(false)
  })

  it('matches any of several selected types', () => {
    const filters: RoomFilters = { ...NO_ROOM_FILTERS, types: ['suite', 'king'] }
    expect(filterRooms(GRID, filters).map((r) => r.roomType)).toEqual(['suite', 'king'])
  })

  it('ANDs across dimensions', () => {
    const filters: RoomFilters = { types: ['standard'], hotels: ['h1'], statuses: ['full'] }
    expect(filterRooms(GRID, filters)).toHaveLength(1)
    expect(filterRooms(GRID, filters)[0].occupied).toBe(2)
  })
})

describe('the count on the Filter button', () => {
  it('is zero with nothing on, and one per selection after', () => {
    expect(activeRoomFilterCount(NO_ROOM_FILTERS)).toBe(0)
    expect(
      activeRoomFilterCount({ types: ['suite', 'king'], hotels: ['h1'], statuses: ['empty'] }),
    ).toBe(4)
  })
})

describe('the facet counts on every chip', () => {
  it('counts the whole grid when no filter is on', () => {
    const counts = roomFilterCounts(GRID, NO_ROOM_FILTERS)
    expect(counts.total).toBe(6)
    expect(counts.types.standard).toBe(2)
    expect(counts.types.suite).toBe(1)
    expect(counts.hotels.h1).toBe(4)
    expect(counts.hotels.h2).toBe(2)
    expect(counts.statuses.empty).toBe(2)
    expect(counts.statuses.partly).toBe(2)
    expect(counts.statuses.full).toBe(2)
  })

  it('leaves the sibling chips of the same dimension alive', () => {
    // The bug this guards: counting against the already-filtered list makes
    // every other type chip read 0 the instant a type is chosen, so the screen
    // says "there are no suites" while six rooms are one tap away.
    const filters: RoomFilters = { ...NO_ROOM_FILTERS, types: ['suite'] }
    const counts = roomFilterCounts(GRID, filters)
    expect(counts.types.suite).toBe(1)
    expect(counts.types.standard).toBe(2)
    expect(counts.types.deluxe).toBe(1)
  })

  it('narrows a different dimension by the current selection', () => {
    // With Suite chosen, the hotel chips count suites only (there is 1, in h1)
    // and the status chips count suites only (it is empty).
    const counts = roomFilterCounts(GRID, { ...NO_ROOM_FILTERS, types: ['suite'] })
    expect(counts.hotels.h1).toBe(1)
    expect(counts.hotels.h2).toBe(0)
    expect(counts.statuses.empty).toBe(1)
    expect(counts.statuses.full).toBe(0)
  })
})

describe('toggling a selection', () => {
  it('adds then removes', () => {
    expect(toggleInList([], 'deluxe')).toEqual(['deluxe'])
    expect(toggleInList(['deluxe'], 'deluxe')).toEqual([])
  })

  it('keeps the others when one is removed', () => {
    expect(toggleInList(['suite', 'king'], 'suite')).toEqual(['king'])
  })
})

describe('the single venue', () => {
  it('is the first hotel, or nothing', () => {
    expect(venueValue(NO_ROOM_FILTERS)).toBe('')
    expect(venueValue({ ...NO_ROOM_FILTERS, hotels: ['h2'] })).toBe('h2')
  })

  it('replaces rather than accumulates, and clears on empty', () => {
    expect(withVenue(NO_ROOM_FILTERS, 'h1').hotels).toEqual(['h1'])
    expect(withVenue({ ...NO_ROOM_FILTERS, hotels: ['h1'] }, 'h2').hotels).toEqual(['h2'])
    expect(withVenue({ ...NO_ROOM_FILTERS, hotels: ['h1'] }, '').hotels).toEqual([])
  })

  it('does not disturb the other dimensions', () => {
    const filters: RoomFilters = { types: ['suite'], hotels: [], statuses: ['empty'] }
    expect(withVenue(filters, 'h1')).toEqual({
      types: ['suite'],
      hotels: ['h1'],
      statuses: ['empty'],
    })
  })
})

describe('the remembered venue', () => {
  function fakeStorage(seed: Record<string, string> = {}): VenueStorage & { map: Record<string, string> } {
    const map = { ...seed }
    return {
      map,
      getItem: (key) => map[key] ?? null,
      setItem: (key, value) => {
        map[key] = value
      },
      removeItem: (key) => {
        delete map[key]
      },
    }
  }

  it('round-trips a venue per event', () => {
    const storage = fakeStorage()
    writeStoredVenue(storage, 'EV1', 'h1')
    expect(readStoredVenue(storage, 'EV1')).toBe('h1')
    expect(readStoredVenue(storage, 'EV2')).toBeNull()
    expect(storage.map[venueStorageKey('EV1')]).toBe('h1')
  })

  it('clears the key when the venue is cleared', () => {
    const storage = fakeStorage({ [venueStorageKey('EV1')]: 'h1' })
    writeStoredVenue(storage, 'EV1', null)
    expect(readStoredVenue(storage, 'EV1')).toBeNull()
  })

  it('treats a throwing storage as no preference, never an error', () => {
    // Safari private mode: getItem throws. The board must still render.
    const hostile: VenueStorage = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
      removeItem: () => {
        throw new Error('denied')
      },
    }
    expect(readStoredVenue(hostile, 'EV1')).toBeNull()
    expect(() => writeStoredVenue(hostile, 'EV1', 'h1')).not.toThrow()
  })

  it('treats a missing storage as no preference', () => {
    expect(readStoredVenue(null, 'EV1')).toBeNull()
    expect(() => writeStoredVenue(undefined, 'EV1', 'h1')).not.toThrow()
  })
})
