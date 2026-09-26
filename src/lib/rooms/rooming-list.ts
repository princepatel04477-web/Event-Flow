/**
 * The rooming list's pure parts — the row shape a hotel is handed, and the
 * three things a person does to it: filter it by a count, search it, sort it.
 *
 * SEPARATE FROM `board.ts` BECAUSE THE UNIT IS DIFFERENT. The Rooms board's
 * unit is a ROOM (a card per room, occupants inside it). A rooming list's unit
 * is a ROOM × FAMILY pair, because a shared room is two lines on the sheet the
 * front desk works from — one family checks in at 2pm and the other at 9pm, and
 * a single line cannot carry two check-in states. Rooms with nobody in them are
 * lines too: a rooming list that silently omits room 214 is how a hotel loses
 * track of a room it is holding.
 *
 * Pure and unit-tested for the same reason `board.ts` is: every function here
 * fails by quietly misleading rather than by throwing. A sort that puts room 9
 * after room 10, a search that misses a family because the sheet capitalised the
 * name differently, a tile whose count does not match the rows it filters to —
 * none of those break anything. They just make the printed sheet wrong.
 */

import { compareRoomNumbers, matchesTerm } from './board'

/**
 * Where a family stands against its room.
 *
 * `no_family` is a state of the ROW, not of a person: the room exists and is
 * empty. It is kept distinct from `not_yet` because "nobody is assigned here"
 * and "somebody is assigned and has not arrived" are different jobs — the first
 * is an allocation problem, the second is a front-desk one.
 */
export type RoomingCheckIn = 'in' | 'out' | 'not_yet' | 'no_family'

/**
 * `none` means no hamper row exists for this family yet, which is NOT the same
 * as pending. Hampers are created by an admin action (`generateDeliverables`)
 * and by the auto-hamper trigger on room assignment, so a family can hold a
 * room before anything is owed to them.
 */
export type RoomingHamper = 'delivered' | 'pending' | 'none'

export interface RoomingListRow {
  /**
   * The row's identity. `roomId:groupId` rather than either alone, because a
   * shared room contributes one row per family and an empty room contributes
   * one row with no family at all.
   */
  key: string
  roomId: string
  hotelId: string
  hotelName: string
  roomNumber: string
  /** Free text as the hotel writes it ("Deluxe twin"), or null. */
  roomType: string | null
  floor: string | null
  isBlocked: boolean
  /** Null on an empty room. */
  groupId: string | null
  headName: string | null
  /** Beds this family holds IN THIS ROOM — not the family's headcount. */
  pax: number
  /** The people in those beds, in the order the read returned them. */
  guestNames: string[]
  checkIn: RoomingCheckIn
  checkedInAt: string | null
  checkedOutAt: string | null
  hamper: RoomingHamper
  /** The deliverable to open for the proof photo. Null when `hamper` is none. */
  hamperDeliverableId: string | null
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export type RoomingColumn = 'room' | 'type' | 'family' | 'pax' | 'checkIn' | 'hamper'

export interface RoomingSort {
  column: RoomingColumn
  direction: 'asc' | 'desc'
}

/** Hotel, then room. The order the ticket asks for and the sheet's default. */
export const DEFAULT_ROOMING_SORT: RoomingSort = { column: 'room', direction: 'asc' }

/**
 * Check-in sorted by URGENCY, not alphabetically.
 *
 * "in" < "not_yet" alphabetically, which would sort the families who have
 * already arrived above the ones still standing at the desk. The order below is
 * the order a front desk cares about: who is still coming, who is here, who has
 * gone, and which rooms are spare.
 */
const CHECK_IN_ORDER: Record<RoomingCheckIn, number> = {
  not_yet: 0,
  in: 1,
  out: 2,
  no_family: 3,
}

/** Same reasoning: what is still owed comes first. */
const HAMPER_ORDER: Record<RoomingHamper, number> = {
  pending: 0,
  delivered: 1,
  none: 2,
}

/**
 * Sort the list, with hotel-then-room as the tiebreak on EVERY column.
 *
 * The tiebreak is not tidiness. Without it, sorting by Pax leaves every
 * two-guest room in whatever order the database happened to return, so tapping
 * the same header twice shows two different orders and the reader cannot tell
 * whether the list changed or the sort did.
 */
export function sortRoomingRows(
  rows: readonly RoomingListRow[],
  sort: RoomingSort = DEFAULT_ROOMING_SORT,
): RoomingListRow[] {
  const sign = sort.direction === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => {
    const primary = compareByColumn(a, b, sort.column)
    if (primary !== 0) return primary * sign
    return placeOrder(a, b)
  })
}

function compareByColumn(a: RoomingListRow, b: RoomingListRow, column: RoomingColumn): number {
  switch (column) {
    case 'room':
      // Hotel first, so "sort by room" means the sheet a hotel can read.
      return placeOrder(a, b)
    case 'type':
      return (a.roomType ?? '').localeCompare(b.roomType ?? '', undefined, { sensitivity: 'base' })
    case 'family':
      // An empty room sorts after every named family rather than under "".
      if ((a.headName === null) !== (b.headName === null)) return a.headName === null ? 1 : -1
      return (a.headName ?? '').localeCompare(b.headName ?? '', undefined, { sensitivity: 'base' })
    case 'pax':
      return a.pax - b.pax
    case 'checkIn':
      return CHECK_IN_ORDER[a.checkIn] - CHECK_IN_ORDER[b.checkIn]
    case 'hamper':
      return HAMPER_ORDER[a.hamper] - HAMPER_ORDER[b.hamper]
  }
}

/** Hotel name, then natural room number, then the key so ties are stable. */
function placeOrder(a: RoomingListRow, b: RoomingListRow): number {
  return (
    a.hotelName.localeCompare(b.hotelName, undefined, { sensitivity: 'base' }) ||
    compareRoomNumbers(a.roomNumber, b.roomNumber) ||
    a.key.localeCompare(b.key)
  )
}

/**
 * The next sort for a header tap.
 *
 * A new column starts ascending; the active column flips. Tapping a third time
 * does NOT clear the sort — a table with no order is not a state anyone wants,
 * and "back to the default" is what the Hotel/room header is for.
 */
export function nextSort(current: RoomingSort, column: RoomingColumn): RoomingSort {
  if (current.column !== column) return { column, direction: 'asc' }
  return { column, direction: current.direction === 'asc' ? 'desc' : 'asc' }
}

// ---------------------------------------------------------------------------
// Searching
// ---------------------------------------------------------------------------

/**
 * Search by name or room number — and by hotel, room type and every guest in
 * the room, because all five are things a person has in front of them when they
 * come to this screen looking for one line.
 */
export function searchRoomingRows(
  rows: readonly RoomingListRow[],
  term: string,
): RoomingListRow[] {
  if (term.trim().length === 0) return [...rows]
  return rows.filter((row) =>
    matchesTerm(term, row.roomNumber, row.hotelName, row.roomType, row.headName, ...row.guestNames),
  )
}

// ---------------------------------------------------------------------------
// The count tiles, and the list behind each one
// ---------------------------------------------------------------------------

export type RoomingTile = 'occupied' | 'checkedIn' | 'awaiting' | 'hampers'

export interface RoomingTileSummary {
  id: RoomingTile
  label: string
  done: number
  total: number
  /** What the tile shows when it is on — the filter's own sentence. */
  filterLabel: string
}

/** True when this row belongs to the list behind that tile. */
export function rowInTile(row: RoomingListRow, tile: RoomingTile): boolean {
  switch (tile) {
    case 'occupied':
      return row.groupId !== null
    case 'checkedIn':
      return row.checkIn === 'in'
    case 'awaiting':
      return row.checkIn === 'not_yet'
    case 'hampers':
      // The list behind "Hampers delivered" is what is still OWED. A tile that
      // filtered to the delivered rows would be a tile whose tap shows you the
      // work you have already done.
      return row.hamper === 'pending'
  }
}

export function filterRoomingRows(
  rows: readonly RoomingListRow[],
  tile: RoomingTile | null,
): RoomingListRow[] {
  if (tile === null) return [...rows]
  return rows.filter((row) => rowInTile(row, tile))
}

/**
 * The four numbers at the top, each of which is a door into the rows behind it.
 *
 * TWO RELATIONSHIPS, BOTH ASSERTED, AND THEY ARE NOT THE SAME ONE. A tile whose
 * number and whose list disagree is the specific failure this shape exists to
 * make impossible — it is how a screen reports 12 pending hampers and then shows
 * you 9 — but "the number" means a different side of the same set for the last
 * tile, so one invariant cannot cover all four honestly:
 *
 *   - `occupied`, `checkedIn`, `awaiting`: the number IS the list. `done` equals
 *     the count of rows the tile filters to, exactly.
 *   - `hampers`: the number is what is DONE and the list is what is OWED, so
 *     `done` plus the filtered count is the total. A tile reading "Hampers
 *     delivered 3/8" that filtered to its own 3 delivered rows would be a tap
 *     that shows you the work you have already finished; its `filterLabel` says
 *     "Hampers still to deliver" and the list behind it is the 5 that are left.
 *     The sum is the whole, and that is the contract.
 *
 * An earlier version of this comment claimed the first relationship for all
 * four, which is false for `hampers` — the test that asserted it failed, and
 * that failure is exactly the kind this file is written to surface.
 */
export function roomingTiles(rows: readonly RoomingListRow[]): RoomingTileSummary[] {
  const withFamily = rows.filter((r) => r.groupId !== null)
  const owed = rows.filter((r) => r.hamper !== 'none')

  return [
    {
      id: 'occupied',
      label: 'Rooms with a family',
      done: withFamily.length,
      total: rows.length,
      filterLabel: 'Rooms with a family',
    },
    {
      id: 'checkedIn',
      label: 'Checked in',
      done: rows.filter((r) => r.checkIn === 'in').length,
      total: withFamily.length,
      filterLabel: 'Checked in',
    },
    {
      id: 'awaiting',
      label: 'Still to arrive',
      done: rows.filter((r) => r.checkIn === 'not_yet').length,
      total: withFamily.length,
      filterLabel: 'Still to arrive',
    },
    {
      id: 'hampers',
      label: 'Hampers delivered',
      done: owed.filter((r) => r.hamper === 'delivered').length,
      total: owed.length,
      filterLabel: 'Hampers still to deliver',
    },
  ]
}

// ---------------------------------------------------------------------------
// The words on the sheet
// ---------------------------------------------------------------------------

/**
 * The check-in cell, in the words the check-in screen already uses.
 *
 * Same vocabulary as `CheckInClient` ("In", "Out", "Not yet") so the two
 * screens cannot be read as describing two different states of one family.
 */
export function checkInLabel(row: RoomingListRow): string {
  switch (row.checkIn) {
    case 'in':
      return 'In'
    case 'out':
      return 'Out'
    case 'not_yet':
      return 'Not yet'
    case 'no_family':
      return row.isBlocked ? 'Out of service' : 'Empty'
  }
}

export function hamperLabel(row: RoomingListRow): string {
  switch (row.hamper) {
    case 'delivered':
      return 'Delivered'
    case 'pending':
      return 'To deliver'
    case 'none':
      return '—'
  }
}

/** "Rakesh Sharma, Sunita Sharma" — every name, for the sheet and the sheet's cell. */
export function guestNamesLabel(row: RoomingListRow): string {
  return row.guestNames.length > 0 ? row.guestNames.join(', ') : '—'
}

/** The family cell. Never an id, never the word "Unknown". */
export function familyLabel(row: RoomingListRow): string {
  const name = row.headName?.trim()
  if (name) return name
  return row.groupId === null ? '—' : 'Unnamed family'
}

/** "Hotel Grand · 214" — where the row is, for a sheet title or a sheet label. */
export function placeLabel(row: RoomingListRow): string {
  return `${row.hotelName} · ${row.roomNumber}`
}

/**
 * The one line under the tiles: how many rows are showing, and why.
 *
 * Says the filter out loud, because a filtered table that looks like the whole
 * table is how somebody reports a missing family that is simply not in the
 * current view.
 */
export function roomingCountLine(
  shown: number,
  total: number,
  tile: RoomingTile | null,
  term: string,
): string {
  const rows = `${shown} ${shown === 1 ? 'row' : 'rows'}`
  if (shown === total && tile === null && term.trim().length === 0) {
    return `${rows} · every room on the event`
  }
  const why: string[] = []
  if (tile !== null) {
    why.push(roomingTiles([]).find((t) => t.id === tile)?.filterLabel.toLowerCase() ?? 'filtered')
  }
  if (term.trim().length > 0) why.push(`matching “${term.trim()}”`)
  return `${rows} of ${total} · ${why.join(' · ')}`
}
