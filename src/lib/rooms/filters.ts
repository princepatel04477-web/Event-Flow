/**
 * The Rooms board's filter model, as pure functions.
 *
 * WHY THIS FILE EXISTS. A 168-room grid is not a list you scroll; it is a
 * register you interrogate ("which suites are still free in the Grand", "what
 * is only half-filled"). The board grew a single `Filter · n` sheet for that,
 * and this module is the sheet's arithmetic: which room a chip matches, how
 * many rooms each chip would leave, and how many filters are on.
 *
 * Pure and DOM-free so `tests/rooms-filters.test.ts` can pin the three things
 * that are wrong quietly: a status chip that counts a blocked room as "empty",
 * a facet count that drops to zero the moment you select the chip beside it,
 * and a "clear" that does not actually clear.
 */

import { ROOM_TYPES, normaliseRoomType, type RoomType } from './room-type'

/** How full a room is. The three states the board colours and filters on. */
export type OccupancyStatus = 'empty' | 'partly' | 'full'

export const OCCUPANCY_STATUSES: readonly OccupancyStatus[] = ['empty', 'partly', 'full']

export const OCCUPANCY_LABELS: Record<OccupancyStatus, string> = {
  empty: 'Empty',
  partly: 'Partly filled',
  full: 'Full',
}

/** The columns a filter reads. A grid room and a board row both satisfy it. */
export interface RoomFilterable {
  roomType: string | null | undefined
  hotelId: string
  capacity: number
  occupied: number
}

/**
 * Empty / partly filled / full, from bed counts only.
 *
 * A blocked room ("out of service") is NOT special-cased here: its occupancy is
 * whatever is actually in it, and the board already renders it separately. The
 * chip counts below therefore agree with the squares on the card.
 */
export function occupancyStatus(room: RoomFilterable): OccupancyStatus {
  if (room.occupied <= 0) return 'empty'
  if (room.capacity > 0 && room.occupied >= room.capacity) return 'full'
  return 'partly'
}

export interface RoomFilters {
  readonly types: readonly RoomType[]
  readonly hotels: readonly string[]
  readonly statuses: readonly OccupancyStatus[]
}

export const NO_ROOM_FILTERS: RoomFilters = { types: [], hotels: [], statuses: [] }

/** Does this room pass every active filter? An empty dimension passes all. */
export function matchesRoomFilters(room: RoomFilterable, filters: RoomFilters): boolean {
  if (filters.types.length > 0) {
    const type = normaliseRoomType(room.roomType)
    if (!type || !filters.types.includes(type)) return false
  }
  if (filters.hotels.length > 0 && !filters.hotels.includes(room.hotelId)) return false
  if (filters.statuses.length > 0 && !filters.statuses.includes(occupancyStatus(room))) {
    return false
  }
  return true
}

/** The rooms under the current filters, in the order the grid returned them. */
export function filterRooms<T extends RoomFilterable>(
  rooms: readonly T[],
  filters: RoomFilters,
): T[] {
  return rooms.filter((room) => matchesRoomFilters(room, filters))
}

/** The number on the "Filter · n" button: one per active selection. */
export function activeRoomFilterCount(filters: RoomFilters): number {
  return filters.types.length + filters.hotels.length + filters.statuses.length
}

export interface RoomFilterCounts {
  readonly types: Record<RoomType, number>
  readonly hotels: Record<string, number>
  readonly statuses: Record<OccupancyStatus, number>
  /** Every room in the grid, before any filter. */
  readonly total: number
}

/**
 * The number on every chip.
 *
 * FACET COUNTS, not totals: each chip counts the rooms that would remain if
 * that chip alone were chosen, given the filters on the OTHER dimensions. That
 * is what keeps a chip row usable — pick "Suite" and the "Partly filled" chip
 * still reports the partly-filled suites, so the second tap is an informed one.
 * Counting against the already-filtered list instead would drive every sibling
 * chip to zero and read as "there is nothing else", which is false.
 */
export function roomFilterCounts(
  rooms: readonly RoomFilterable[],
  filters: RoomFilters,
): RoomFilterCounts {
  const countWith = (override: Partial<RoomFilters>): number =>
    rooms.filter((room) => matchesRoomFilters(room, { ...filters, ...override })).length

  const types = {} as Record<RoomType, number>
  for (const type of ROOM_TYPES) types[type] = countWith({ types: [type] })

  const statuses = {} as Record<OccupancyStatus, number>
  for (const status of OCCUPANCY_STATUSES) statuses[status] = countWith({ statuses: [status] })

  const hotels: Record<string, number> = {}
  for (const hotelId of new Set(rooms.map((room) => room.hotelId))) {
    hotels[hotelId] = countWith({ hotels: [hotelId] })
  }

  return { types, hotels, statuses, total: rooms.length }
}

/** Toggle one value in a readonly multiselect dimension. */
export function toggleInList<T extends string>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

/** The single venue, as a select value — '' when every venue is showing. */
export function venueValue(filters: RoomFilters): string {
  return filters.hotels[0] ?? ''
}

/** Set the one venue ('' clears it), leaving the other dimensions untouched. */
export function withVenue(filters: RoomFilters, hotelId: string): RoomFilters {
  return { ...filters, hotels: hotelId ? [hotelId] : [] }
}
