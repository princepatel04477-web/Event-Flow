/**
 * Presentation helpers for the client guest screen.
 *
 * Pure and dependency-light on purpose: no Supabase, no `server-only`, no
 * React. Everything here takes a `client_guest_profiles` row (or a slice of
 * one) and returns strings a component can render without further thought.
 *
 * The honesty rule for this file: never invent a value and never render the
 * word "null". A missing arrival date means "not shared yet", not "no arrival".
 */

import { format, isValid, parseISO } from 'date-fns'

import type { Database } from '@/lib/supabase/database.types'
// Reuse the app's single label maps rather than growing a fourth copy — the
// review form and this screen must not disagree on what "self_drive" is called.
import { SIDE_LABELS, TRAVEL_MODE_LABELS } from '@/lib/review/payload'

export type GuestRow = Database['public']['Views']['client_guest_profiles']['Row']

type GroupType = Database['app']['Enums']['group_type']
type Side = Database['app']['Enums']['side']
type TravelMode = Database['app']['Enums']['travel_mode']

/** `app.group_type` has no label map elsewhere in the app, so it lives here. */
const GROUP_TYPE_LABELS: Record<GroupType, string> = {
  family: 'Family',
  couple: 'Couple',
  friends: 'Friends',
  single: 'Single',
}

export function groupTypeLabel(value: GroupType | null): string | null {
  return value ? GROUP_TYPE_LABELS[value] : null
}

export function sideLabel(value: Side | null): string | null {
  if (!value) return null
  // A bare "Both" / "Other" chip next to a name reads as nonsense, but note
  // 'other' is a RECORDED choice — it must not be relabelled "not recorded".
  if (value === 'both') return 'Both sides'
  if (value === 'other') return 'Other side'
  return `${SIDE_LABELS[value]}'s side`
}

/**
 * Format a Postgres `date` (always `YYYY-MM-DD`).
 *
 * `parseISO` on a date-only string yields local midnight, so the calendar day
 * survives formatting. Never hand this a timestamptz.
 */
export function formatLegDate(value: string | null): string | null {
  if (!value) return null
  const parsed = parseISO(value)
  if (!isValid(parsed)) return null
  return format(parsed, 'EEE d MMM yyyy')
}

/**
 * Format a Postgres `time` (`HH:mm:ss`).
 *
 * Anchored to an arbitrary date so date-fns has a full instant to parse; only
 * the clock half is ever rendered. 24-hour, matching `formatDateTime` in
 * `@/lib/utils` — staff and clients compare these across screens.
 */
export function formatLegTime(value: string | null): string | null {
  if (!value) return null
  const parsed = parseISO(`1970-01-01T${value}`)
  if (!isValid(parsed)) return null
  return format(parsed, 'HH:mm')
}

export type LegInput = {
  date: string | null
  time: string | null
  mode: TravelMode | null
  point: string | null
}

export type LegView = {
  /** Line one: the day and clock time, or an honest stand-in. */
  when: string
  /** Line two: mode and pickup/drop point. Null when neither is known. */
  detail: string | null
  /** False when the leg is completely blank — nothing has been shared at all. */
  known: boolean
}

/**
 * Collapse a travel leg into the two lines the card renders.
 *
 * A leg can be partly known (mode but no date, or a date with no time), so
 * this distinguishes "nothing shared" from "date not shared" instead of
 * flattening both to an empty row.
 */
export function describeLeg(input: LegInput): LegView {
  const date = formatLegDate(input.date)
  const time = formatLegTime(input.time)
  const mode = input.mode ? TRAVEL_MODE_LABELS[input.mode] : null
  const point = input.point?.trim() || null

  const when = [date, time].filter(Boolean).join(' · ')
  const detail = [mode, point].filter(Boolean).join(' · ')

  if (!when && !detail) {
    return { when: 'Not shared yet', detail: null, known: false }
  }

  return {
    when: when || 'Date not shared yet',
    detail: detail || null,
    known: true,
  }
}

/**
 * Where this guest is staying.
 *
 * Rooms are Phase 2, so null is the ordinary case today — the copy says
 * "not allocated yet", never anything that reads like a failure.
 */
export function describeRoom(row: GuestRow): string {
  const hotel = row.hotel_name?.trim() || null
  const room = row.room_number?.trim() || null

  if (hotel && room) return `${hotel} · Room ${room}`
  if (hotel) return `${hotel} · Room not allocated yet`
  return 'Room not allocated yet'
}

export type GuestFamily = {
  /** Stable React key. Not a database id — families are grouped by name. */
  key: string
  /** Null when the row carries no `family_head`. */
  head: string | null
  guests: GuestRow[]
}

/**
 * Bucket rows by `family_head`.
 *
 * Guests with no recorded head each get their own bucket — merging them would
 * assert a family that the data does not claim. Matching is case- and
 * whitespace-insensitive because heads arrive from a hand-typed spreadsheet
 * ("Kirit Patel" vs "kirit patel " are one family).
 */
export function groupByFamilyHead(rows: GuestRow[]): GuestFamily[] {
  const families = new Map<string, GuestFamily>()

  rows.forEach((row, index) => {
    const head = row.family_head?.trim() || null
    const key = head ? `head:${head.toLocaleLowerCase()}` : `solo:${row.guest_id ?? index}`

    const existing = families.get(key)
    if (existing) {
      existing.guests.push(row)
      return
    }

    families.set(key, { key, head, guests: [row] })
  })

  for (const family of families.values()) {
    family.guests.sort((a, b) =>
      (a.guest_name ?? '').localeCompare(b.guest_name ?? '', 'en-IN'),
    )
  }

  return [...families.values()].sort((a, b) =>
    (a.head ?? '').localeCompare(b.head ?? '', 'en-IN'),
  )
}
