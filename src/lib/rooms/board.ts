/**
 * The Rooms board's pure parts — the header line, the search, and the
 * hotel → floor grouping the Rooms tab renders.
 *
 * Pure and unit-tested, because these are the three things that are wrong in a
 * way nobody notices: a header line that says "41 beds free" when a blocked
 * room is counted, a search that misses a family because the sheet wrote the
 * name in a different case, and a floor grouping that puts room 9 after room
 * 10. None of those throw; they just quietly mislead somebody holding a key
 * card in a corridor.
 */

/** What the top line counts. Mirrors `RoomsBoardTotals` from the read. */
export interface BoardTotals {
  confirmedGuests: number
  guestsWithBed: number
  bedsFree: number
  familiesWaiting: number
}

/**
 * "312 of 465 guests have a bed · 41 beds free · 14 families waiting"
 *
 * The state of the world in one line, which is the rule every screen in this
 * rebuild follows. Clauses that say nothing are dropped rather than rendered as
 * a zero: "0 families waiting" reads as a warning at a glance, and the thing it
 * is reporting is that the work is finished.
 */
export function boardSummary(totals: BoardTotals): string {
  const parts: string[] = [
    `${totals.guestsWithBed} of ${totals.confirmedGuests} ${
      totals.confirmedGuests === 1 ? 'guest has' : 'guests have'
    } a bed`,
  ]
  parts.push(`${totals.bedsFree} ${totals.bedsFree === 1 ? 'bed' : 'beds'} free`)
  if (totals.familiesWaiting > 0) {
    parts.push(
      `${totals.familiesWaiting} ${totals.familiesWaiting === 1 ? 'family' : 'families'} waiting`,
    )
  } else {
    parts.push('everyone is placed')
  }
  return parts.join(' · ')
}

/**
 * Does any of these fields contain the search term?
 *
 * Case-folded and trimmed on both sides. An empty term matches everything,
 * which is what makes the search box safe to leave empty rather than a filter
 * that has to be cleared.
 */
export function matchesTerm(
  term: string,
  ...fields: readonly (string | number | null | undefined)[]
): boolean {
  const needle = term.trim().toLowerCase()
  if (needle.length === 0) return true
  return fields.some((field) => {
    if (field === null || field === undefined) return false
    return String(field).toLowerCase().includes(needle)
  })
}

/** Natural room-number order: 9 before 10, and A101 before A102. */
export function compareRoomNumbers(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

interface RoomLike {
  hotelId: string
  hotelName: string
  roomNumber: string
  floor: string | null
}

export interface FloorGroup<T> {
  /** The raw floor value, '' when the hotel did not record one. */
  floor: string
  /** What the heading says — "2nd floor" as written, or "Floor not recorded". */
  label: string
  rooms: T[]
}

export interface HotelGroup<T> {
  hotelId: string
  hotelName: string
  floors: FloorGroup<T>[]
  roomCount: number
}

/**
 * Rooms grouped hotel → floor, each list in natural room order.
 *
 * `floor` is free text in the database (`rooms.floor` is `text`), because
 * hotels label floors "G", "1", "Mezzanine" and "2nd". So it is grouped as a
 * string and sorted numerically-aware, never parsed into a number — parsing
 * would collapse "G" and "Ground" into the same NaN and sort them on top of
 * each other unpredictably.
 */
export function groupRoomsByHotelFloor<T extends RoomLike>(rooms: readonly T[]): HotelGroup<T>[] {
  const hotels = new Map<string, HotelGroup<T>>()

  for (const room of rooms) {
    let hotel = hotels.get(room.hotelId)
    if (!hotel) {
      hotel = { hotelId: room.hotelId, hotelName: room.hotelName, floors: [], roomCount: 0 }
      hotels.set(room.hotelId, hotel)
    }
    const floor = (room.floor ?? '').trim()
    let group = hotel.floors.find((f) => f.floor === floor)
    if (!group) {
      group = { floor, label: floorLabel(floor), rooms: [] }
      hotel.floors.push(group)
    }
    group.rooms.push(room)
    hotel.roomCount += 1
  }

  const out = [...hotels.values()]
  out.sort((a, b) => a.hotelName.localeCompare(b.hotelName) || a.hotelId.localeCompare(b.hotelId))
  for (const hotel of out) {
    // A floor with no label sorts last: it is the leftover, not the ground.
    hotel.floors.sort((a, b) => {
      if ((a.floor === '') !== (b.floor === '')) return a.floor === '' ? 1 : -1
      return a.floor.localeCompare(b.floor, undefined, { numeric: true, sensitivity: 'base' })
    })
    for (const group of hotel.floors) {
      group.rooms.sort((a, b) => compareRoomNumbers(a.roomNumber, b.roomNumber))
    }
  }
  return out
}

function floorLabel(floor: string): string {
  if (floor === '') return 'Floor not recorded'
  // "2" becomes "Floor 2"; "Ground" and "2nd floor" are already sentences.
  return /^\d+$/.test(floor) ? `Floor ${floor}` : floor
}

/** "2 of 3 beds" — the line under a room number on the Rooms tab. */
export function bedsLabel(occupied: number, capacity: number): string {
  return `${occupied} of ${capacity} ${capacity === 1 ? 'bed' : 'beds'}`
}

/** "6 guests · no room yet" / "6 guests · 2 placed, 4 to go". */
export function waitingLabel(headcount: number, placed: number): string {
  const people = `${headcount} ${headcount === 1 ? 'guest' : 'guests'}`
  if (placed <= 0) return `${people} · no room yet`
  return `${people} · ${placed} placed, ${headcount - placed} to go`
}
