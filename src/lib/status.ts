/**
 * The app's status vocabulary — one definition, used everywhere.
 *
 * Twenty screens built by twenty prompt sessions drift: "Delivered" here,
 * "Done" there, "Complete" somewhere else, and a dry-run team reads them as
 * three different things. This module is the single source of truth for how
 * every status is worded and coloured.
 *
 * The colour rule is absolute: ledger red means ATTENTION (overdue, over
 * capacity, unbalanced, destructive), ledger green means COMPLETED
 * (delivered, confirmed, balanced). Nothing else gets either colour, and a
 * status's wording never changes between screens.
 *
 * Pure and browser-safe: no `server-only`, no Supabase client.
 */

import type { Database } from '@/lib/supabase/database.types'

/* ------------------------------------------------------------------ */
/* Tones                                                               */
/* ------------------------------------------------------------------ */

/**
 * The semantic tone of a status. Maps onto the ledger palette:
 * - `attention` — ledger red. Needs eyes on it: overdue, over capacity,
 *   unbalanced, a destructive confirmation.
 * - `done`      — ledger green. Completed: delivered, confirmed, balanced.
 * - `active`    — in hand, in progress (a lock, an assignment).
 * - `neutral`   — everything else.
 *
 * `StatusPill` in the ui library is the only component that renders a tone.
 * No ad-hoc coloured spans anywhere else.
 */
export type StatusTone = 'neutral' | 'active' | 'attention' | 'done'

/* ------------------------------------------------------------------ */
/* RSVP — the calling funnel                                           */
/* ------------------------------------------------------------------ */

export type RsvpStatus = Database['app']['Enums']['rsvp_status']

export const RSVP_STATUS_OPTIONS: RsvpStatus[] = [
  'not_started',
  'attempted',
  'callback',
  'tentative',
  'confirmed',
  'declined',
  'unreachable',
]

/**
 * Wording is fixed here. "Attempted" and "Callback" are the same words on
 * the queue, the call screen and the review form — they must never read
 * differently.
 */
export const RSVP_STATUS_LABELS: Record<RsvpStatus, string> = {
  not_started: 'Not started',
  attempted: 'Attempted',
  callback: 'Callback',
  tentative: 'Tentative',
  confirmed: 'Confirmed',
  declined: 'Declined',
  unreachable: 'Unreachable',
}

/**
 * Callback and tentative are neutral: unfinished work, nothing wrong, not
 * in-hand. Confirmed is green. Declined and unreachable are red: a family
 * that cannot be reached is a live gap.
 */
export const RSVP_STATUS_TONES: Record<RsvpStatus, StatusTone> = {
  not_started: 'neutral',
  attempted: 'neutral',
  callback: 'neutral',
  tentative: 'neutral',
  confirmed: 'done',
  declined: 'attention',
  unreachable: 'attention',
}

/* ------------------------------------------------------------------ */
/* Delivery — the hamper / return-gift funnel                          */
/* ------------------------------------------------------------------ */

export type DeliveryStatus = Database['app']['Enums']['deliverable_status']

export const DELIVERY_STATUS_OPTIONS: DeliveryStatus[] = [
  'pending',
  'assigned',
  'delivered',
  'not_required',
]

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  pending: 'Pending',
  assigned: 'Assigned',
  delivered: 'Delivered',
  not_required: 'Not required',
}

/**
 * Delivered is green — the only completed state. Pending and assigned are
 * neutral/active: work in hand, nothing wrong. Not required is neutral: the
 * group was never owed one (e.g. no return gift on record).
 */
export const DELIVERY_STATUS_TONES: Record<DeliveryStatus, StatusTone> = {
  pending: 'neutral',
  assigned: 'active',
  delivered: 'done',
  not_required: 'neutral',
}

/* ------------------------------------------------------------------ */
/* Ledger — arrivals against departures                                */
/* ------------------------------------------------------------------ */

export type LedgerStatus = 'balanced' | 'departure_missing' | 'no_arrival'

export const LEDGER_STATUS_OPTIONS: LedgerStatus[] = [
  'balanced',
  'departure_missing',
  'no_arrival',
]

export const LEDGER_STATUS_LABELS: Record<LedgerStatus, string> = {
  balanced: 'Balanced',
  departure_missing: 'Departure missing',
  no_arrival: 'No arrival',
}

/**
 * Balanced is green. A departure missing or no arrival is red: an
 * unaccounted-for person is exactly what this ledger exists to catch.
 */
export const LEDGER_STATUS_TONES: Record<LedgerStatus, StatusTone> = {
  balanced: 'done',
  departure_missing: 'attention',
  no_arrival: 'attention',
}

/* ------------------------------------------------------------------ */
/* Room occupancy                                                      */
/* ------------------------------------------------------------------ */

export type RoomStatus = 'empty' | 'partly_full' | 'full' | 'over_capacity'

export const ROOM_STATUS_OPTIONS: RoomStatus[] = [
  'empty',
  'partly_full',
  'full',
  'over_capacity',
]

export const ROOM_STATUS_LABELS: Record<RoomStatus, string> = {
  empty: 'Empty',
  partly_full: 'Partly full',
  full: 'Full',
  over_capacity: 'Over capacity',
}

/**
 * Only over-capacity is red — it is the only room state that needs eyes on
 * it. Empty/partly/full are all fine states.
 */
export const ROOM_STATUS_TONES: Record<RoomStatus, StatusTone> = {
  empty: 'neutral',
  partly_full: 'neutral',
  full: 'neutral',
  over_capacity: 'attention',
}

/* ------------------------------------------------------------------ */
/* Loose-string helpers                                                */
/* ------------------------------------------------------------------ */

const ALL_LABELS: Record<string, string> = {
  ...RSVP_STATUS_LABELS,
  ...DELIVERY_STATUS_LABELS,
  ...LEDGER_STATUS_LABELS,
  ...ROOM_STATUS_LABELS,
}

const ALL_TONES: Record<string, StatusTone> = {
  ...RSVP_STATUS_TONES,
  ...DELIVERY_STATUS_TONES,
  ...LEDGER_STATUS_TONES,
  ...ROOM_STATUS_TONES,
}

function isKnownStatus(value: string): value is keyof typeof ALL_LABELS {
  return value in ALL_LABELS
}

/**
 * Label any status that arrived as a loose string (a view column, AI
 * output). Unknown values pass through unchanged rather than guessing —
 * a new enum value must not silently render as something else.
 */
export function statusLabel(value: string | null | undefined): string {
  if (!value) return 'Not started'
  return isKnownStatus(value) ? ALL_LABELS[value] : value
}

/** Tone for a status that arrived as a loose string. */
export function statusTone(value: string | null | undefined): StatusTone {
  if (!value || !isKnownStatus(value)) return 'neutral'
  return ALL_TONES[value]
}
