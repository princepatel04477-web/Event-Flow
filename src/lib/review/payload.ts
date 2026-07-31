/**
 * The single place that knows the extraction contract does NOT match the
 * apply_rsvp_extraction() payload shape. See
 * eventflow/Pipelines/Extraction Contract.md and
 * eventflow/Database/Schema Reality Check.md before touching this file.
 *
 * Deliberately dependency-free and free of `server-only` / Supabase imports
 * so it can be exercised directly by a test runner or a plain Node script —
 * "isolated and unit-testable" per the task brief.
 */

import type { Database } from '@/lib/supabase/database.types'
// RSVP status labels/options live in @/lib/rsvp — one map for the queue, the
// call screen and this form, which had each grown their own.
import { RSVP_STATUS_LABELS, RSVP_STATUS_OPTIONS, type RsvpStatus } from '@/lib/rsvp'

export { RSVP_STATUS_LABELS, RSVP_STATUS_OPTIONS }
export type { RsvpStatus }

export type Side = Database['app']['Enums']['side']
export type TravelMode = Database['app']['Enums']['travel_mode']

export const SIDE_OPTIONS: Side[] = ['bride', 'groom', 'both', 'other']

export const TRAVEL_MODE_OPTIONS: TravelMode[] = ['air', 'train', 'bus', 'cab', 'self_drive']

export const SIDE_LABELS: Record<Side, string> = {
  bride: 'Bride',
  groom: 'Groom',
  both: 'Both',
  other: 'Other',
}

export const TRAVEL_MODE_LABELS: Record<TravelMode, string> = {
  air: 'Air',
  train: 'Train',
  bus: 'Bus',
  cab: 'Cab',
  self_drive: 'Self-drive',
}

// ---------------------------------------------------------------------
// What the extraction model emits into rsvp_extractions.parsed
// ---------------------------------------------------------------------

export interface ExtractionLeg {
  date: string | null
  time: string | null
  mode: string | null
  reference: string | null
  point: string | null
  pax: number | null
}

/** Defensive shape of `rsvp_extractions.parsed`. The model may omit keys. */
export interface ExtractionParsed {
  rsvp_status: string | null
  confirmed_pax: number | null
  arrival: ExtractionLeg | null
  departure: ExtractionLeg | null
  special_requests: string | null
  language: string | null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asLeg(value: unknown): ExtractionLeg | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Record<string, unknown>
  return {
    date: typeof v.date === 'string' ? v.date : null,
    time: typeof v.time === 'string' ? v.time : null,
    mode: typeof v.mode === 'string' ? v.mode : null,
    reference: typeof v.reference === 'string' ? v.reference : null,
    point: typeof v.point === 'string' ? v.point : null,
    pax: typeof v.pax === 'number' ? v.pax : null,
  }
}

/** Parse `rsvp_extractions.parsed` (a `Json` column) defensively. */
export function parseExtractionPayload(parsed: unknown): ExtractionParsed {
  const r = asRecord(parsed)
  return {
    rsvp_status: typeof r.rsvp_status === 'string' ? r.rsvp_status : null,
    confirmed_pax: typeof r.confirmed_pax === 'number' ? r.confirmed_pax : null,
    arrival: asLeg(r.arrival),
    departure: asLeg(r.departure),
    special_requests: typeof r.special_requests === 'string' ? r.special_requests : null,
    language: typeof r.language === 'string' ? r.language : null,
  }
}

// ---------------------------------------------------------------------
// What apply_rsvp_extraction() actually reads. Everything else in the
// extraction's `parsed` JSON — special_requests (unmapped), language,
// confidence — is silently ignored by the RPC.
// ---------------------------------------------------------------------

export interface RpcLegPayload {
  mode?: string | null
  date?: string | null
  time?: string | null
  reference?: string | null
  point?: string | null
  pax?: number | null
}

export interface RpcPayload {
  rsvp_status?: RsvpStatus
  confirmed_pax?: number
  side?: Side
  remarks?: string
  arrival?: RpcLegPayload
  departure?: RpcLegPayload
}

// ---------------------------------------------------------------------
// Form state — everything the reviewer can edit, as strings (HTML inputs).
// ---------------------------------------------------------------------

export interface LegFormValues {
  mode: string
  date: string
  time: string
  reference: string
  point: string
  pax: string
}

export interface ReviewFormValues {
  rsvpStatus: string
  confirmedPax: string
  /** Not emitted by the model — reviewer-supplied, prefilled from the group's current value. */
  side: string
  /** Prefilled from parsed.special_requests, which maps to `remarks` on commit. */
  remarks: string
  arrival: LegFormValues
  departure: LegFormValues
}

export const EMPTY_LEG_FORM_VALUES: LegFormValues = {
  mode: '',
  date: '',
  time: '',
  reference: '',
  point: '',
  pax: '',
}

function toFormString(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

/** Postgres `time` comes back as "HH:MM:SS" — <input type="time"> wants "HH:MM". */
export function toTimeInputValue(value: string | null | undefined): string {
  if (!value) return ''
  return value.length >= 5 ? value.slice(0, 5) : value
}

// ---------------------------------------------------------------------
// Existing DB state — what apply_rsvp_extraction()'s coalesce() falls back
// to. This is NOT the same as the extraction's parsed values, and it is what
// clear-attempt detection must compare against.
// ---------------------------------------------------------------------

export interface ExistingGroupValues {
  rsvpStatus: string | null
  confirmedPax: number | null
  side: string | null
  remarks: string | null
}

export interface ExistingLegValues {
  mode: string | null
  date: string | null
  time: string | null
  reference: string | null
  pax: number | null
  point: string | null
}

function legFormValues(
  parsedLeg: ExtractionLeg | null,
  existing: ExistingLegValues | null,
): LegFormValues {
  return {
    mode: toFormString(parsedLeg?.mode ?? existing?.mode ?? null),
    date: toFormString(parsedLeg?.date ?? existing?.date ?? null),
    time: toTimeInputValue(toFormString(parsedLeg?.time ?? existing?.time ?? null) || null),
    reference: toFormString(parsedLeg?.reference ?? existing?.reference ?? null),
    point: toFormString(parsedLeg?.point ?? existing?.point ?? null),
    pax: toFormString(parsedLeg?.pax ?? existing?.pax ?? null),
  }
}

/**
 * Prefill the review form: the model's extraction wins where it has an
 * opinion, otherwise fall back to what is already on the group / leg today.
 */
export function buildInitialFormValues(
  parsed: ExtractionParsed,
  existingGroup: ExistingGroupValues,
  existingArrival: ExistingLegValues | null,
  existingDeparture: ExistingLegValues | null,
): ReviewFormValues {
  return {
    rsvpStatus: toFormString(parsed.rsvp_status ?? existingGroup.rsvpStatus),
    confirmedPax: toFormString(parsed.confirmed_pax ?? existingGroup.confirmedPax),
    side: toFormString(existingGroup.side),
    remarks: toFormString(parsed.special_requests ?? existingGroup.remarks),
    arrival: legFormValues(parsed.arrival, existingArrival),
    departure: legFormValues(parsed.departure, existingDeparture),
  }
}

// ---------------------------------------------------------------------
// Building the RPC payload
// ---------------------------------------------------------------------

function normalize(raw: string): string | null {
  const trimmed = raw.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Whole numbers only, and only when the input really IS a whole number.
 *
 * `Number.parseInt("15.7")` returns 15 with no error, so a mistyped decimal
 * used to write a smaller pax silently. Anything that is not an integer comes
 * back as null here and is reported separately by `detectInvalidNumbers()`,
 * which blocks the accept button — a pax count must never be quietly rounded
 * down on someone's behalf.
 */
function parseIntOrNull(raw: string): number | null {
  const normalized = normalize(raw)
  if (normalized === null) return null
  if (!/^-?\d+$/.test(normalized)) return null
  const n = Number(normalized)
  return Number.isSafeInteger(n) ? n : null
}

export interface InvalidNumber {
  field: string
  label: string
  raw: string
}

function checkNumber(raw: string, field: string, label: string, out: InvalidNumber[]): void {
  const normalized = normalize(raw)
  if (normalized === null) return
  if (parseIntOrNull(normalized) === null || Number(normalized) < 0) {
    out.push({ field, label, raw: normalized })
  }
}

/**
 * Every pax field the reviewer typed that is not a non-negative whole
 * number. The UI must block accept while this is non-empty: silently
 * dropping or truncating a pax count is how a family arrives with more
 * people than the rooms booked for them.
 */
export function detectInvalidNumbers(values: ReviewFormValues): InvalidNumber[] {
  const out: InvalidNumber[] = []
  checkNumber(values.confirmedPax, 'confirmedPax', 'Confirmed pax', out)
  checkNumber(values.arrival.pax, 'arrival.pax', 'Arrival pax', out)
  checkNumber(values.departure.pax, 'departure.pax', 'Departure pax', out)
  return out
}

/**
 * Never emit an empty string. apply_rsvp_extraction() casts rsvp_status,
 * confirmed_pax and side straight from the JSON with no `nullif(value, '')`
 * guard (unlike the leg fields, which do use nullif) — sending "" for those
 * raises a cast error instead of being treated as "leave alone". Omitting
 * the key (or sending JSON null) is what actually means "leave alone", so
 * every builder below normalizes blank strings to `undefined`.
 */
function buildLegPayload(leg: LegFormValues): RpcLegPayload | undefined {
  const mode = normalize(leg.mode)
  const date = normalize(leg.date)
  const time = normalize(leg.time)
  const reference = normalize(leg.reference)
  const point = normalize(leg.point)
  const pax = parseIntOrNull(leg.pax)

  if (mode === null && date === null && time === null && reference === null && point === null && pax === null) {
    // Nothing to send — omit the whole key so the RPC does not touch (or
    // worse, insert an empty) travel leg for this direction.
    return undefined
  }

  const payload: RpcLegPayload = {}
  if (mode !== null) payload.mode = mode
  if (date !== null) payload.date = date
  if (time !== null) payload.time = time
  if (reference !== null) payload.reference = reference
  if (point !== null) payload.point = point
  if (pax !== null) payload.pax = pax
  return payload
}

/** Translate the review form into exactly the shape apply_rsvp_extraction() reads. */
export function buildRpcPayload(values: ReviewFormValues): RpcPayload {
  const payload: RpcPayload = {}

  const rsvpStatus = normalize(values.rsvpStatus)
  if (rsvpStatus !== null) payload.rsvp_status = rsvpStatus as RsvpStatus

  const confirmedPax = parseIntOrNull(values.confirmedPax)
  if (confirmedPax !== null) payload.confirmed_pax = confirmedPax

  const side = normalize(values.side)
  if (side !== null) payload.side = side as Side

  // special_requests -> remarks. This is the single most likely place to
  // silently lose data if the mapping is skipped.
  const remarks = normalize(values.remarks)
  if (remarks !== null) payload.remarks = remarks

  const arrival = buildLegPayload(values.arrival)
  if (arrival) payload.arrival = arrival

  const departure = buildLegPayload(values.departure)
  if (departure) payload.departure = departure

  return payload
}

// ---------------------------------------------------------------------
// Detecting "the reviewer thinks they cleared a field, but coalesce()
// will silently keep the old value" — apply_rsvp_extraction() has no way
// to null a field out.
// ---------------------------------------------------------------------

export interface ClearAttempt {
  /** Dotted field key, matching the CONFIDENCE_PATHS convention. */
  field: string
  label: string
  existingValue: string
}

function checkClear(
  formRaw: string,
  existing: string | number | null,
  field: string,
  label: string,
  attempts: ClearAttempt[],
): void {
  if (normalize(formRaw) === null && existing !== null && String(existing).trim() !== '') {
    attempts.push({ field, label, existingValue: String(existing) })
  }
}

/**
 * Returns every field the reviewer blanked out that will NOT actually be
 * cleared by apply_rsvp_extraction() — the database will keep whatever is
 * already there. The UI should block submission while this is non-empty,
 * or the reviewer walks away believing a bad flight number is gone when it
 * is not.
 */
export function detectClearAttempts(
  values: ReviewFormValues,
  existingGroup: ExistingGroupValues,
  existingArrival: ExistingLegValues | null,
  existingDeparture: ExistingLegValues | null,
): ClearAttempt[] {
  const attempts: ClearAttempt[] = []

  checkClear(values.rsvpStatus, existingGroup.rsvpStatus, 'rsvpStatus', 'RSVP status', attempts)
  checkClear(values.confirmedPax, existingGroup.confirmedPax, 'confirmedPax', 'Confirmed pax', attempts)
  checkClear(values.side, existingGroup.side, 'side', 'Side', attempts)
  checkClear(values.remarks, existingGroup.remarks, 'remarks', 'Remarks', attempts)

  if (existingArrival) {
    checkClear(values.arrival.mode, existingArrival.mode, 'arrival.mode', 'Arrival mode', attempts)
    checkClear(values.arrival.date, existingArrival.date, 'arrival.date', 'Arrival date', attempts)
    checkClear(
      values.arrival.time,
      toTimeInputValue(existingArrival.time),
      'arrival.time',
      'Arrival time',
      attempts,
    )
    checkClear(
      values.arrival.reference,
      existingArrival.reference,
      'arrival.reference',
      'Arrival reference',
      attempts,
    )
    checkClear(values.arrival.point, existingArrival.point, 'arrival.point', 'Arrival point', attempts)
    checkClear(values.arrival.pax, existingArrival.pax, 'arrival.pax', 'Arrival pax', attempts)
  }

  if (existingDeparture) {
    checkClear(values.departure.mode, existingDeparture.mode, 'departure.mode', 'Departure mode', attempts)
    checkClear(values.departure.date, existingDeparture.date, 'departure.date', 'Departure date', attempts)
    checkClear(
      values.departure.time,
      toTimeInputValue(existingDeparture.time),
      'departure.time',
      'Departure time',
      attempts,
    )
    checkClear(
      values.departure.reference,
      existingDeparture.reference,
      'departure.reference',
      'Departure reference',
      attempts,
    )
    checkClear(
      values.departure.point,
      existingDeparture.point,
      'departure.point',
      'Departure point',
      attempts,
    )
    checkClear(values.departure.pax, existingDeparture.pax, 'departure.pax', 'Departure pax', attempts)
  }

  return attempts
}
