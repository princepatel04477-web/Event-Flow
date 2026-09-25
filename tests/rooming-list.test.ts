/**
 * The rooming list's pure parts — `src/lib/rooms/rooming-list.ts`, plus the
 * workbook sheet it exports.
 *
 * Everything here fails QUIETLY in production rather than throwing: a sort that
 * puts room 9 after room 10, a search that misses a family because the sheet
 * capitalised the name differently, and — the one that matters most — a count
 * tile whose number does not match the rows its filter shows. That last one is
 * how a screen reports 12 pending hampers and then shows you 9, so it is
 * asserted as an invariant over the whole tile set rather than one case at a
 * time.
 */

import { describe, expect, it } from 'vitest'

import { roomingListFileName, roomingListSheet } from '@/lib/export/rooming-list'
import {
  DEFAULT_ROOMING_SORT,
  checkInLabel,
  familyLabel,
  filterRoomingRows,
  guestNamesLabel,
  hamperLabel,
  nextSort,
  roomingCountLine,
  roomingTiles,
  rowInTile,
  searchRoomingRows,
  sortRoomingRows,
  type RoomingListRow,
  type RoomingTile,
} from '@/lib/rooms/rooming-list'

function row(overrides: Partial<RoomingListRow> & { key: string }): RoomingListRow {
  return {
    roomId: 'room-1',
    hotelId: 'hotel-1',
    hotelName: 'Grand Palace',
    roomNumber: '101',
    roomType: null,
    floor: null,
    isBlocked: false,
    groupId: null,
    headName: null,
    pax: 0,
    guestNames: [],
    checkIn: 'no_family',
    checkedInAt: null,
    checkedOutAt: null,
    hamper: 'none',
    hamperDeliverableId: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

describe('sortRoomingRows', () => {
  const rows: RoomingListRow[] = [
    row({ key: 'b:2', roomId: 'b', hotelName: 'Aster Inn', roomNumber: '10' }),
    row({ key: 'a:9', roomId: 'a', hotelName: 'Grand Palace', roomNumber: '9' }),
    row({ key: 'a:10', roomId: 'a', hotelName: 'Grand Palace', roomNumber: '10' }),
    row({ key: 'a:101', roomId: 'a', hotelName: 'Grand Palace', roomNumber: '101' }),
  ]

  it('defaults to hotel, then room, in natural number order', () => {
    expect(sortRoomingRows(rows).map((r) => r.roomNumber)).toEqual(['10', '9', '10', '101'])
  })

  it('is the documented default without an argument', () => {
    expect(sortRoomingRows(rows)).toEqual(sortRoomingRows(rows, DEFAULT_ROOMING_SORT))
  })

  it('puts room 9 before room 10 rather than after it', () => {
    const grandOnly = rows.filter((r) => r.hotelName === 'Grand Palace')
    expect(sortRoomingRows(grandOnly).map((r) => r.roomNumber)).toEqual(['9', '10', '101'])
  })

  it('sorts pax ascending, with the place order as the tiebreak', () => {
    const byPax = sortRoomingRows(
      [
        row({ key: 'x', roomNumber: '20', hotelName: 'Aster', pax: 3 }),
        row({ key: 'y', roomNumber: '10', hotelName: 'Aster', pax: 3 }),
        row({ key: 'z', roomNumber: '5', hotelName: 'Aster', pax: 1 }),
      ],
      { column: 'pax', direction: 'asc' },
    )
    expect(byPax.map((r) => r.roomNumber)).toEqual(['5', '10', '20'])
  })

  it('flips to descending on the same column', () => {
    const byPax = sortRoomingRows(
      [
        row({ key: 'x', roomNumber: '20', pax: 3 }),
        row({ key: 'z', roomNumber: '5', pax: 1 }),
      ],
      { column: 'pax', direction: 'desc' },
    )
    expect(byPax.map((r) => r.roomNumber)).toEqual(['20', '5'])
  })

  it('sorts check-in by urgency, not alphabetically', () => {
    const byCheckIn = sortRoomingRows(
      [
        row({ key: 'in', roomNumber: '1', checkIn: 'in', groupId: 'g1' }),
        row({ key: 'out', roomNumber: '2', checkIn: 'out', groupId: 'g2' }),
        row({ key: 'none', roomNumber: '3', checkIn: 'no_family' }),
        row({ key: 'yet', roomNumber: '4', checkIn: 'not_yet', groupId: 'g3' }),
      ],
      { column: 'checkIn', direction: 'asc' },
    )
    expect(byCheckIn.map((r) => r.checkIn)).toEqual(['not_yet', 'in', 'out', 'no_family'])
  })

  it('sorts hampers owed before delivered before none', () => {
    const byHamper = sortRoomingRows(
      [
        row({ key: 'none', roomNumber: '1', hamper: 'none' }),
        row({ key: 'done', roomNumber: '2', hamper: 'delivered' }),
        row({ key: 'owed', roomNumber: '3', hamper: 'pending' }),
      ],
      { column: 'hamper', direction: 'asc' },
    )
    expect(byHamper.map((r) => r.hamper)).toEqual(['pending', 'delivered', 'none'])
  })

  it('sorts an empty room after every named family', () => {
    const byFamily = sortRoomingRows(
      [
        row({ key: 'empty', roomNumber: '1', headName: null }),
        row({ key: 'named', roomNumber: '2', headName: 'Ravi Sharma', groupId: 'g1' }),
      ],
      { column: 'family', direction: 'asc' },
    )
    expect(byFamily.map((r) => r.headName)).toEqual(['Ravi Sharma', null])
  })

  it('does not mutate the array it is handed', () => {
    const original = [row({ key: 'b', roomNumber: '2' }), row({ key: 'a', roomNumber: '1' })]
    const before = original.map((r) => r.key)
    sortRoomingRows(original)
    expect(original.map((r) => r.key)).toEqual(before)
  })
})

describe('nextSort', () => {
  it('starts a new column ascending', () => {
    expect(nextSort({ column: 'room', direction: 'desc' }, 'pax')).toEqual({
      column: 'pax',
      direction: 'asc',
    })
  })

  it('flips the active column', () => {
    expect(nextSort({ column: 'pax', direction: 'asc' }, 'pax')).toEqual({
      column: 'pax',
      direction: 'desc',
    })
  })
})

// ---------------------------------------------------------------------------
// Searching
// ---------------------------------------------------------------------------

describe('searchRoomingRows', () => {
  const rows = [
    row({
      key: '1',
      roomNumber: '214',
      hotelName: 'Grand Palace',
      roomType: 'Deluxe twin',
      headName: 'Ravi Sharma',
      groupId: 'g1',
      guestNames: ['Ravi Sharma', 'Sunita Sharma'],
    }),
    row({ key: '2', roomNumber: 'G3', hotelName: 'Aster Inn' }),
  ]

  it('returns everything for an empty term', () => {
    expect(searchRoomingRows(rows, '   ')).toHaveLength(2)
  })

  it('matches a room number', () => {
    expect(searchRoomingRows(rows, '214').map((r) => r.key)).toEqual(['1'])
  })

  it('matches a name case-insensitively', () => {
    expect(searchRoomingRows(rows, 'SUNITA').map((r) => r.key)).toEqual(['1'])
  })

  it('matches the hotel and the room type', () => {
    expect(searchRoomingRows(rows, 'aster').map((r) => r.key)).toEqual(['2'])
    expect(searchRoomingRows(rows, 'deluxe').map((r) => r.key)).toEqual(['1'])
  })

  it('matches a guest who is not the family head', () => {
    expect(searchRoomingRows(rows, 'sunita').map((r) => r.key)).toEqual(['1'])
  })

  it('matches nothing on a term that is not there', () => {
    expect(searchRoomingRows(rows, 'zzz')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// The count tiles — the invariant that matters
// ---------------------------------------------------------------------------

describe('roomingTiles', () => {
  const rows: RoomingListRow[] = [
    row({
      key: 'a',
      groupId: 'g1',
      headName: 'Ravi',
      pax: 2,
      checkIn: 'in',
      hamper: 'delivered',
      hamperDeliverableId: 'd1',
    }),
    row({ key: 'b', groupId: 'g2', headName: 'Sunita', pax: 1, checkIn: 'not_yet', hamper: 'pending', hamperDeliverableId: 'd2' }),
    row({ key: 'c', groupId: 'g3', headName: 'Anil', pax: 1, checkIn: 'out', hamper: 'delivered', hamperDeliverableId: 'd3' }),
    row({ key: 'd', roomNumber: '404' }),
  ]

  const tiles: RoomingTile[] = ['occupied', 'checkedIn', 'awaiting', 'hampers']

  // The number on a tile is the count of the side of the set it reports. For
  // three of them that IS the list behind the tap; for `hampers` the number is
  // what is done and the list is what is owed, so the two add up to the total.
  // Asserted per tile, because a tile whose number and list disagree is how a
  // screen says "12 to deliver" and then shows you 9.
  it('counts each state tile from the exact rows it filters to', () => {
    for (const summary of roomingTiles(rows)) {
      if (summary.id === 'hampers') continue
      expect(summary.done).toBe(rows.filter((r) => rowInTile(r, summary.id)).length)
    }
  })

  it('makes the hampers number plus its list equal the total it reports', () => {
    const hampers = roomingTiles(rows).find((t) => t.id === 'hampers')!
    expect(hampers.done + rows.filter((r) => rowInTile(r, 'hampers')).length).toBe(
      hampers.total,
    )
  })

  it('keeps both relationships when nothing is owed and nothing is placed', () => {
    const empty = [row({ key: 'x' }), row({ key: 'y', roomNumber: '2' })]
    for (const summary of roomingTiles(empty)) {
      const filtered = empty.filter((r) => rowInTile(r, summary.id)).length
      if (summary.id === 'hampers') {
        expect(summary.done + filtered).toBe(summary.total)
      } else {
        expect(summary.done).toBe(filtered)
      }
    }
  })

  it('never reports a number larger than its denominator', () => {
    for (const summary of roomingTiles(rows)) {
      expect(summary.done).toBeLessThanOrEqual(summary.total)
      expect(summary.total).toBeGreaterThanOrEqual(0)
    }
  })

  it('counts four tiles, each with its own filter sentence', () => {
    const summaries = roomingTiles(rows)
    expect(summaries.map((t) => t.id)).toEqual(tiles)
    for (const summary of summaries) expect(summary.filterLabel.length).toBeGreaterThan(0)
  })

  it('reports the rooms with a family against every room on the event', () => {
    const occupied = roomingTiles(rows).find((t) => t.id === 'occupied')!
    expect(occupied.done).toBe(3)
    expect(occupied.total).toBe(4)
  })

  it('reports hampers delivered out of every hamper that exists', () => {
    const hampers = roomingTiles(rows).find((t) => t.id === 'hampers')!
    // Three families hold a hamper row; two are delivered. The fourth row has
    // no hamper at all, so it is not in the denominator.
    expect(hampers.done).toBe(2)
    expect(hampers.total).toBe(3)
  })

  it('filters to what is still OWED behind the hampers tile, not what is done', () => {
    const shown = filterRoomingRows(rows, 'hampers')
    expect(shown.map((r) => r.key)).toEqual(['b'])
  })
})

describe('filterRoomingRows', () => {
  const rows = [row({ key: 'a', groupId: 'g1' }), row({ key: 'b' })]

  it('returns everything for no tile', () => {
    expect(filterRoomingRows(rows, null)).toHaveLength(2)
  })

  it('keeps only rows with a family behind the occupied tile', () => {
    expect(filterRoomingRows(rows, 'occupied').map((r) => r.key)).toEqual(['a'])
  })
})

// ---------------------------------------------------------------------------
// The words on the sheet
// ---------------------------------------------------------------------------

describe('labels', () => {
  it('names check-in in the check-in screen\'s own vocabulary', () => {
    expect(checkInLabel(row({ key: '1', checkIn: 'in', groupId: 'g' }))).toBe('In')
    expect(checkInLabel(row({ key: '2', checkIn: 'out', groupId: 'g' }))).toBe('Out')
    expect(checkInLabel(row({ key: '3', checkIn: 'not_yet', groupId: 'g' }))).toBe('Not yet')
  })

  it('tells an empty room from one the hotel has taken out of service', () => {
    expect(checkInLabel(row({ key: '1' }))).toBe('Empty')
    expect(checkInLabel(row({ key: '2', isBlocked: true }))).toBe('Out of service')
  })

  it('never prints a hamper it does not have as pending', () => {
    expect(hamperLabel(row({ key: '1', hamper: 'pending' }))).toBe('To deliver')
    expect(hamperLabel(row({ key: '2', hamper: 'delivered' }))).toBe('Delivered')
    expect(hamperLabel(row({ key: '3', hamper: 'none' }))).toBe('—')
  })

  it('joins every guest name, and shows a dash when there are none', () => {
    expect(guestNamesLabel(row({ key: '1', guestNames: ['Ravi', 'Sunita'] }))).toBe(
      'Ravi, Sunita',
    )
    expect(guestNamesLabel(row({ key: '2' }))).toBe('—')
  })

  it('never prints an id or the word Unknown for a family', () => {
    expect(familyLabel(row({ key: '1', groupId: 'g1', headName: '  ' }))).toBe('Unnamed family')
    expect(familyLabel(row({ key: '2' }))).toBe('—')
    expect(familyLabel(row({ key: '3', groupId: 'g1', headName: 'Ravi Kumar' }))).toBe(
      'Ravi Kumar',
    )
  })
})

describe('roomingCountLine', () => {
  it('says when the whole event is on screen', () => {
    expect(roomingCountLine(12, 12, null, '')).toBe('12 rows · every room on the event')
  })

  it('says what the filter is, out loud', () => {
    expect(roomingCountLine(3, 12, 'awaiting', '')).toBe(
      '3 rows of 12 · still to arrive',
    )
  })

  it('says what the search is', () => {
    expect(roomingCountLine(1, 12, null, '214')).toBe('1 row of 12 · matching “214”')
  })

  it('says both when both are on, and gets the singular right', () => {
    expect(roomingCountLine(1, 12, 'awaiting', 'sharma')).toBe(
      '1 row of 12 · still to arrive · matching “sharma”',
    )
  })
})

// ---------------------------------------------------------------------------
// The exported sheet
// ---------------------------------------------------------------------------

describe('roomingListSheet', () => {
  const rows = [
    row({
      key: '1',
      roomNumber: '0214',
      hotelName: 'Grand Palace',
      roomType: 'Deluxe',
      floor: '2',
      groupId: 'g1',
      headName: 'Ravi Sharma',
      pax: 2,
      guestNames: ['Ravi Sharma', 'Sunita Sharma'],
      checkIn: 'in',
      hamper: 'delivered',
    }),
  ]

  it('keeps the leading zero on a room number as a string cell', () => {
    const sheet = roomingListSheet(rows)
    const column = (sheet.columns as { key: string; type?: string }[]).find(
      (c) => c.key === 'roomNumber',
    )
    expect(column?.type).toBe('string')
  })

  it('colours only the rows that need action', () => {
    const sheet = roomingListSheet(rows)
    const isException = sheet.isException as (r: RoomingListRow) => boolean
    expect(isException(rows[0])).toBe(false)
    expect(isException(row({ key: '2', isBlocked: true }))).toBe(true)
    expect(isException(row({ key: '3', checkIn: 'not_yet', groupId: 'g' }))).toBe(true)
    expect(isException(row({ key: '4', hamper: 'pending' }))).toBe(true)
  })

  it('writes the rows in the order it is handed them', () => {
    const sheet = roomingListSheet(rows)
    expect(sheet.rows[0]).toBe(rows[0])
  })
})

describe('roomingListFileName', () => {
  it('stamps the event name and the minute', () => {
    expect(roomingListFileName('Sharma Wedding', new Date(2026, 7, 16, 14, 30))).toBe(
      'EventFlow_Rooming_List_Sharma_Wedding_2026-08-16_1430.xlsx',
    )
  })

  it('strips a separator that would become a path segment', () => {
    expect(roomingListFileName('Sharma / Patel', new Date(2026, 7, 16, 9, 5))).toBe(
      'EventFlow_Rooming_List_Sharma_Patel_2026-08-16_0905.xlsx',
    )
  })

  it('falls back to Event for a nameless event', () => {
    expect(roomingListFileName('', new Date(2026, 7, 16, 9, 5))).toBe(
      'EventFlow_Rooming_List_Event_2026-08-16_0905.xlsx',
    )
  })
})
