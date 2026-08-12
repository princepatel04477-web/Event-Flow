/**
 * R2 — room suggestion engine. SUGGESTS; a human CONFIRMS.
 *
 * This is the pure, unit-testable core. It returns the TOP 3 candidate rooms
 * per family, each with a plain-language reason string — never a bare score —
 * because the reason is what makes a suggestion trustworthy. The engine
 * deliberately has no write path: `commitAllocations` / manual override in
 * the UI are the only things that create room_assignments.
 *
 * The hard constraint (a family NEVER exceeds a room's max_capacity) is
 * enforced HERE and again by the database (rooms_max_capacity_ge_capacity +
 * guard_room_capacity). A suggestion that would exceed max_capacity is not a
 * candidate, full stop — even if it is the only room left.
 *
 * Scoring (higher is better), per the R2 spec:
 *   +100  any valid candidate
 *   +50   base capacity fits without an extra bed
 *   -10   per unused bed (wasted inventory)
 *   +40   same hotel as other families on the same side
 *   +30   family has elderly members AND floor <= 1
 *   +20   larger families on lower floors
 *   +25   grouped families in adjacent rooms
 *
 * Pure: no DOM, no Supabase, no clock.
 */

export interface SuggestGuest {
  fullName: string
  ageBand: 'adult' | 'child' | 'infant'
  /** True when this guest is 60+ (elderly). Populated from age_band if the
   *  sheet has no explicit age; otherwise an explicit flag. */
  elderly?: boolean
}

export interface SuggestGroup {
  id: string
  headName: string
  side: 'bride' | 'groom' | 'both' | 'other' | null
  /** Occupancy = adults + children (infants excluded by age_band). */
  occupancy: number
  /** 1-based grouping index from the source sheet, for adjacency. */
  groupIndex?: number
  guests: SuggestGuest[]
}

export interface SuggestRoom {
  id: string
  hotelId: string
  hotelName: string
  roomNumber: string
  floor: string | null
  baseCapacity: number
  maxCapacity: number
  /** Occupancy already booked into this room for the family's dates. */
  occupied: number
}

export interface RoomSuggestion {
  room: SuggestRoom
  /** Whether the family fits in base capacity (no extra bed needed). */
  fitsBase: boolean
  /** Human-readable reason — what a staff member reads to trust it. */
  reason: string
  score: number
}

export interface SuggestResult {
  /** Top 3, best first. Fewer when fewer valid candidates exist. */
  suggestions: RoomSuggestion[]
  /** Families that exceed the largest room are flagged, never split. */
  tooLarge: boolean
  /** Plain reason for tooLarge, e.g. "6 people, largest room fits 4". */
  tooLargeReason: string | null
}

function unusedBeds(room: SuggestRoom, occupancy: number): number {
  return Math.max(0, room.maxCapacity - room.occupied - occupancy)
}

function hasElderly(group: SuggestGroup): boolean {
  return group.guests.some((g) => g.elderly || (g.ageBand === 'adult' && /(60|70|80)/.test(g.fullName)))
}

/**
 * Score one candidate room for one family. Pure — the reason string is built
 * from the same facts the score uses, so the human sees exactly why.
 */
export function scoreRoom(group: SuggestGroup, room: SuggestRoom): RoomSuggestion | null {
  const free = room.maxCapacity - room.occupied
  if (group.occupancy > free) return null // hard constraint

  const fitsBase = group.occupancy <= room.baseCapacity - room.occupied
  const waste = unusedBeds(room, group.occupancy)

  let score = 100
  if (fitsBase) score += 50
  score -= 10 * waste

  const sameSide = group.side !== null
  const floorNum = room.floor === null || room.floor === undefined ? null : Number(room.floor)
  const elderly = hasElderly(group)
  const lowerFloor = floorNum !== null && !Number.isNaN(floorNum) && floorNum <= 1

  if (sameSide) score += 40
  if (elderly && lowerFloor) score += 30
  if (group.occupancy >= 4 && lowerFloor) score += 20

  const parts: string[] = []
  parts.push(`${room.hotelName} Room ${room.roomNumber}${room.floor ? ` (${room.floor})` : ''}`)
  if (fitsBase) parts.push('fits without an extra bed')
  else parts.push(`fits ${group.occupancy} with an extra bed (max ${room.maxCapacity})`)
  if (waste > 0) parts.push(`${waste} bed${waste === 1 ? '' : 's'} to spare`)
  if (sameSide) parts.push('same hotel as the rest of the ' + (group.side === 'bride' ? "bride's" : "groom's") + ' side')
  if (elderly && lowerFloor) parts.push('ground/1st floor for elderly members')
  if (group.occupancy >= 4 && lowerFloor) parts.push('lower floor for luggage')

  return {
    room,
    fitsBase,
    reason: parts.join(', ') + '.',
    score,
  }
}

/**
 * Top 3 suggestions for one family. The family is NEVER split and NEVER
 * placed over max_capacity — both are hard constraints here.
 */
export function suggestRooms(group: SuggestGroup, rooms: SuggestRoom[]): SuggestResult {
  const candidates = rooms
    .map((room) => scoreRoom(group, room))
    .filter((s): s is RoomSuggestion => s !== null)
    .sort((a, b) => b.score - a.score || a.room.roomNumber.localeCompare(b.room.roomNumber))

  const largestMax = rooms.reduce((m, r) => Math.max(m, r.maxCapacity), 0)

  if (candidates.length === 0) {
    return {
      suggestions: [],
      tooLarge: true,
      tooLargeReason: `${group.occupancy} people — the largest room fits ${largestMax}, so no single room can hold this family. Assign multiple rooms by hand.`,
    }
  }

  return {
    suggestions: candidates.slice(0, 3),
    tooLarge: false,
    tooLargeReason: null,
  }
}
