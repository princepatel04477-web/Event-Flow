/**
 * Parsing room numbers out of the three messy places they arrive from:
 * a bulk range, a pasted WhatsApp block, and the `Romm` column of the
 * original Excel sheet.
 *
 * Pure and dependency-free so the preview shown before anything is written
 * is computed by exactly the same code that computes what gets written.
 *
 * The rule throughout: anything that cannot be read cleanly is REPORTED,
 * never guessed. A wrong room number sends a family to a door that is not
 * theirs, which is worse than a blank the user has to fill in.
 */

// ---------------------------------------------------------------------
// Room numbers
// ---------------------------------------------------------------------

/** Room numbers are free text in the schema; we only constrain what we create. */
export const MAX_ROOM_NUMBER_LENGTH = 24

/** Trim, collapse inner whitespace, drop a trailing separator. */
export function normalizeRoomNumber(value: string): string {
  return value.trim().replace(/\s+/g, ' ').replace(/[.,;]+$/, '')
}

/**
 * A cell may legitimately hold more than one room — "201/202" is two rooms
 * for one family, which is common for a family of six in double rooms.
 */
const MULTI_SEPARATOR = /[/&+]|\band\b|\bor\b/i

export interface RoomToken {
  value: string
  /** Set when the token came out of a multi-room cell like "201/202". */
  fromSplit: boolean
}

/**
 * Split one cell into room tokens. Returns an empty array for a blank cell.
 *
 * Deliberately does NOT try to expand "201-205" here: a hyphen inside a room
 * cell is ambiguous (it is also how some hotels write "2-05"), and guessing
 * wrong invents rooms that do not exist. Ranges are an explicit UI action.
 */
export function splitRoomCell(raw: string): RoomToken[] {
  const cell = normalizeRoomNumber(raw)
  if (cell === '') return []

  if (!MULTI_SEPARATOR.test(cell)) {
    return [{ value: cell, fromSplit: false }]
  }

  return cell
    .split(MULTI_SEPARATOR)
    .map((part) => normalizeRoomNumber(part))
    .filter((part) => part !== '')
    .map((value) => ({ value, fromSplit: true }))
}

/** Is this something we are willing to create a room for? */
export function isUsableRoomNumber(value: string): boolean {
  if (value === '' || value.length > MAX_ROOM_NUMBER_LENGTH) return false
  // Must contain at least one digit. "NA", "-", "tbd", "?" and prose are the
  // things this is here to reject.
  return /\d/.test(value)
}

// ---------------------------------------------------------------------
// Bulk range: "rooms 201 to 220"
// ---------------------------------------------------------------------

export interface RangeResult {
  numbers: string[]
  error: string | null
}

export const MAX_RANGE_SIZE = 500

/**
 * Expand an inclusive numeric range, preserving zero padding when both ends
 * are padded to the same width ("008".."012" -> 008, 009, ... 012).
 */
export function expandRoomRange(fromRaw: string, toRaw: string): RangeResult {
  const from = normalizeRoomNumber(fromRaw)
  const to = normalizeRoomNumber(toRaw)

  if (from === '' || to === '') {
    return { numbers: [], error: 'Enter both a first and a last room number.' }
  }
  if (!/^\d+$/.test(from) || !/^\d+$/.test(to)) {
    return {
      numbers: [],
      error: 'A range needs plain numbers at both ends. For anything else, paste the list instead.',
    }
  }

  const start = Number(from)
  const end = Number(to)
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
    return { numbers: [], error: 'Those numbers are too large to be room numbers.' }
  }
  if (end < start) {
    return { numbers: [], error: 'The last room number is lower than the first.' }
  }

  const count = end - start + 1
  if (count > MAX_RANGE_SIZE) {
    return {
      numbers: [],
      error: `That range is ${count} rooms. Add at most ${MAX_RANGE_SIZE} at a time.`,
    }
  }

  // Keep padding only when it is unambiguous: both ends the same width and
  // actually padded. "1".."20" should not become "01".."20".
  const width = from.length === to.length && from.startsWith('0') ? from.length : 0

  const numbers: string[] = []
  for (let n = start; n <= end; n++) {
    numbers.push(width > 0 ? String(n).padStart(width, '0') : String(n))
  }
  return { numbers, error: null }
}

// ---------------------------------------------------------------------
// Pasted block: a WhatsApp message
// ---------------------------------------------------------------------

export interface PastedRooms {
  /** Distinct, usable room numbers, in the order first seen. */
  accepted: string[]
  /** Tokens repeated in the paste. Harmless, but shown so the count adds up. */
  duplicates: string[]
  /** Tokens we will not create a room for, with why. */
  rejected: { value: string; reason: string }[]
}

/**
 * Parse a pasted block. Splits on commas, whitespace and newlines, and also
 * on the multi-room separators, so "201/202, 203" yields three rooms.
 */
export function parsePastedRooms(text: string): PastedRooms {
  const accepted: string[] = []
  const duplicates: string[] = []
  const rejected: { value: string; reason: string }[] = []
  const seen = new Set<string>()

  const chunks = text
    .split(/[\n\r,;\t]+|\s{1,}/)
    .map((c) => c.trim())
    .filter((c) => c !== '')

  for (const chunk of chunks) {
    // A chunk may still be "201/202".
    const tokens = splitRoomCell(chunk)
    if (tokens.length === 0) continue

    for (const token of tokens) {
      const value = token.value
      if (!isUsableRoomNumber(value)) {
        rejected.push({
          value,
          reason: /\d/.test(value) ? 'Too long to be a room number' : 'No digits in it',
        })
        continue
      }
      if (seen.has(value)) {
        duplicates.push(value)
        continue
      }
      seen.add(value)
      accepted.push(value)
    }
  }

  return { accepted, duplicates, rejected }
}

// ---------------------------------------------------------------------
// Capacity
// ---------------------------------------------------------------------

export interface CapacityResult {
  value: number | null
  error: string | null
}

/**
 * Capacity is REQUIRED and must be a positive integer — the database checks
 * it and the allocator divides by it. A room with an unknown capacity is
 * worse than no room at all, so nothing here silently defaults.
 */
export function parseCapacity(raw: string | number | null | undefined): CapacityResult {
  if (raw === null || raw === undefined || raw === '') {
    return { value: null, error: 'Capacity is required.' }
  }
  const text = String(raw).trim()
  if (!/^\d+$/.test(text)) {
    return { value: null, error: 'Capacity must be a whole number of beds.' }
  }
  const n = Number(text)
  if (!Number.isSafeInteger(n) || n <= 0) {
    return { value: null, error: 'Capacity must be at least 1.' }
  }
  if (n > 20) {
    return { value: null, error: `${n} beds in one room looks wrong — check the list.` }
  }
  return { value: n, error: null }
}

// ---------------------------------------------------------------------
// Occupancy
// ---------------------------------------------------------------------

export type OccupancyState = 'empty' | 'partly' | 'full' | 'over'

export const OCCUPANCY_LABELS: Record<OccupancyState, string> = {
  empty: 'Empty',
  partly: 'Partly full',
  full: 'Full',
  over: 'Over capacity',
}

/**
 * `over` is a real state, not an error case: `app.guard_room_capacity()`
 * can be bypassed with `is_override = true` plus a reason, so overfull rooms
 * exist on purpose and have to be visible at a glance.
 */
export function occupancyState(occupied: number, capacity: number): OccupancyState {
  if (occupied > capacity) return 'over'
  if (occupied === 0) return 'empty'
  if (occupied >= capacity) return 'full'
  return 'partly'
}

export function freeBeds(occupied: number, capacity: number): number {
  return Math.max(0, capacity - occupied)
}
