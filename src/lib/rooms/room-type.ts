/**
 * The fixed room-type vocabulary.
 *
 * One source of truth for the five values the database now enforces
 * (`rooms_room_type_check`). Before this there were five disagreeing literal
 * lists in the app: two selects offered 'Standard' | 'Deluxe' | 'Suite' |
 * 'Twin' (no King, no Queen) and the importer's sample sheet shipped a 'Twin'
 * row - which is exactly why the migration has to fold legacy values
 * (see 20260925120000).
 *
 * Lowercase is the STORED form; the label is what a screen shows.
 */

export const ROOM_TYPES = ['suite', 'standard', 'deluxe', 'king', 'queen'] as const

export type RoomType = (typeof ROOM_TYPES)[number]

export const ROOM_TYPE_LABELS: Record<RoomType, string> = {
  suite: 'Suite',
  standard: 'Standard',
  deluxe: 'Deluxe',
  king: 'King',
  queen: 'Queen',
}

/**
 * What the bulk-create screen pre-fills per type. Editable there - a starting
 * point, not a rule. A suite takes an extra bed; the rest are two.
 */
export const ROOM_TYPE_CAPACITY: Record<RoomType, number> = {
  suite: 3,
  standard: 2,
  deluxe: 2,
  king: 2,
  queen: 2,
}

/**
 * Anything -> a stored value, or null.
 *
 * Case- and whitespace-insensitive, because input arrives from a typed form,
 * an Excel column and a select that do not agree about capitalisation. An
 * unrecognised value becomes null rather than being guessed at: null already
 * means "the operator did not say" on every write path, and the CHECK would
 * reject a guess anyway.
 */
export function normaliseRoomType(value: string | null | undefined): RoomType | null {
  if (!value) return null
  const candidate = value.trim().toLowerCase()
  return (ROOM_TYPES as readonly string[]).includes(candidate) ? (candidate as RoomType) : null
}

/** Stored value -> the label to render, or null when there is nothing to say. */
export function roomTypeLabel(value: string | null | undefined): string | null {
  const type = normaliseRoomType(value)
  return type ? ROOM_TYPE_LABELS[type] : null
}