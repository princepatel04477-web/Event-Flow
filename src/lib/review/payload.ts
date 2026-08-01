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
import {
  CONFIDENCE_PATHS,
  bandFor,
  getConfidence,
  type ConfidenceBand,
} from '@/lib/review/confidence'

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

// ---------------------------------------------------------------------
// Field metadata — one table the whole review screen derives from
// ---------------------------------------------------------------------

/** Every editable field, in the dotted form `CONFIDENCE_PATHS` already uses. */
export type FieldKey =
  | 'rsvpStatus'
  | 'confirmedPax'
  | 'side'
  | 'remarks'
  | 'arrival.mode'
  | 'arrival.date'
  | 'arrival.time'
  | 'arrival.reference'
  | 'arrival.point'
  | 'arrival.pax'
  | 'departure.mode'
  | 'departure.date'
  | 'departure.time'
  | 'departure.reference'
  | 'departure.point'
  | 'departure.pax'

export const FIELD_LABELS: Record<FieldKey, string> = {
  rsvpStatus: 'RSVP status',
  confirmedPax: 'Confirmed pax',
  side: 'Side',
  remarks: 'Remarks',
  'arrival.mode': 'Arrival mode',
  'arrival.date': 'Arrival date',
  'arrival.time': 'Arrival time',
  'arrival.reference': 'Arrival reference',
  'arrival.point': 'Arrival point',
  'arrival.pax': 'Arrival pax',
  'departure.mode': 'Departure mode',
  'departure.date': 'Departure date',
  'departure.time': 'Departure time',
  'departure.reference': 'Departure reference',
  'departure.point': 'Departure point',
  'departure.pax': 'Departure pax',
}

const LEG_FIELDS: (keyof LegFormValues)[] = [
  'mode',
  'date',
  'time',
  'reference',
  'point',
  'pax',
]

/** Read one field out of the form state by its dotted key. */
export function getFormValue(values: ReviewFormValues, key: FieldKey): string {
  const dot = key.indexOf('.')
  if (dot === -1) return values[key as 'rsvpStatus' | 'confirmedPax' | 'side' | 'remarks']
  const direction = key.slice(0, dot) as 'arrival' | 'departure'
  return values[direction][key.slice(dot + 1) as keyof LegFormValues]
}

/** Write one field into the form state by its dotted key, immutably. */
export function setFormValue(
  values: ReviewFormValues,
  key: FieldKey,
  value: string,
): ReviewFormValues {
  const dot = key.indexOf('.')
  if (dot === -1) return { ...values, [key]: value }
  const direction = key.slice(0, dot) as 'arrival' | 'departure'
  return { ...values, [direction]: { ...values[direction], [key.slice(dot + 1)]: value } }
}

/**
 * Everything the screen needs to know about one field, resolved once on the
 * server so the three bands (had before / heard now / transcript) all read
 * from the same numbers instead of each recomputing them.
 */
export interface FieldState {
  key: FieldKey
  label: string
  band: ConfidenceBand
  /** The raw score, for the percentage chip. Null when the model gave none. */
  score: number | null
  /** What the model emitted, as a display string. Null when it emitted nothing. */
  extracted: string | null
  /** What the database holds today. Null when the field is unset. */
  existing: string | null
  /** What the input starts at. Blank for `unclear` — that is the whole point. */
  initial: string
  /**
   * The model disagrees with the record. Only ever set for fields we actually
   * pre-filled: flagging a disagreement on a value we deliberately hid would
   * ask the reviewer to compare against something not on screen.
   */
  changed: boolean
}

export type FieldStates = Record<FieldKey, FieldState>

function legValue(leg: ExtractionLeg | null, field: keyof LegFormValues): string | number | null {
  if (!leg) return null
  return leg[field as keyof ExtractionLeg] ?? null
}

function existingLegValue(
  leg: ExistingLegValues | null,
  field: keyof LegFormValues,
): string | number | null {
  if (!leg) return null
  if (field === 'time') return toTimeInputValue(leg.time)
  return leg[field as keyof ExistingLegValues] ?? null
}

/** Normalised comparison — "6" and 6 and " 6 " are the same answer. */
function sameValue(a: string | null, b: string | null): boolean {
  return (a ?? '').trim() === (b ?? '').trim()
}

function buildFieldState(
  key: FieldKey,
  rawExtracted: string | number | null,
  rawExisting: string | number | null,
  confidence: unknown,
): FieldState {
  const extracted = rawExtracted === null || rawExtracted === undefined ? null : String(rawExtracted)
  const existing = rawExisting === null || rawExisting === undefined ? null : String(rawExisting)

  const path = CONFIDENCE_PATHS[key] ?? key
  // `side` is never extracted, so it has no score and no band of its own.
  const hasExtracted = extracted !== null && extracted.trim() !== ''
  const band: ConfidenceBand = key === 'side' ? 'absent' : bandFor(confidence, path, hasExtracted)
  const score = key === 'side' ? null : getConfidence(confidence, path)

  // An `unclear` field starts blank so the reviewer has to make a real
  // decision. Everything else prefers the model's answer, falling back to
  // what the record already holds.
  const initial =
    band === 'unclear' ? '' : hasExtracted ? String(extracted) : (existing ?? '')

  return {
    key,
    label: FIELD_LABELS[key],
    band,
    score,
    extracted,
    existing,
    initial,
    changed: band !== 'unclear' && hasExtracted && !sameValue(extracted, existing),
  }
}

/**
 * Resolve every field's band, prefill and changed-flag in one pass.
 *
 * This is the function the review screen is really built on: `buildInitial-
 * FormValues` below is just its `initial` column collected into the shape the
 * inputs want.
 */
export function buildFieldStates(
  parsed: ExtractionParsed,
  existingGroup: ExistingGroupValues,
  existingArrival: ExistingLegValues | null,
  existingDeparture: ExistingLegValues | null,
  confidence: unknown,
): FieldStates {
  const states = {} as FieldStates

  states.rsvpStatus = buildFieldState(
    'rsvpStatus',
    parsed.rsvp_status,
    existingGroup.rsvpStatus,
    confidence,
  )
  states.confirmedPax = buildFieldState(
    'confirmedPax',
    parsed.confirmed_pax,
    existingGroup.confirmedPax,
    confidence,
  )
  // Reviewer-supplied only — the model never emits it, so it always shows the
  // record's current value and never counts as "changed".
  states.side = buildFieldState('side', null, existingGroup.side, confidence)
  states.remarks = buildFieldState(
    'remarks',
    parsed.special_requests,
    existingGroup.remarks,
    confidence,
  )

  for (const [direction, parsedLeg, existingLeg] of [
    ['arrival', parsed.arrival, existingArrival],
    ['departure', parsed.departure, existingDeparture],
  ] as const) {
    for (const field of LEG_FIELDS) {
      const key = `${direction}.${field}` as FieldKey
      states[key] = buildFieldState(
        key,
        legValue(parsedLeg, field),
        existingLegValue(existingLeg, field),
        confidence,
      )
    }
  }

  return states
}

/** Collect the resolved `initial` values into the shape the inputs bind to. */
export function initialValuesFrom(states: FieldStates): ReviewFormValues {
  const legOf = (direction: 'arrival' | 'departure'): LegFormValues => ({
    mode: states[`${direction}.mode`].initial,
    date: states[`${direction}.date`].initial,
    time: toTimeInputValue(states[`${direction}.time`].initial) || '',
    reference: states[`${direction}.reference`].initial,
    point: states[`${direction}.point`].initial,
    pax: states[`${direction}.pax`].initial,
  })

  return {
    rsvpStatus: states.rsvpStatus.initial,
    confirmedPax: states.confirmedPax.initial,
    side: states.side.initial,
    remarks: states.remarks.initial,
    arrival: legOf('arrival'),
    departure: legOf('departure'),
  }
}

/**
 * Prefill the review form. Confidence-aware: fields the model could not hear
 * clearly arrive blank rather than pre-filled with a doubtful value, because
 * a reviewer waving through a wrong pre-fill is the exact failure this screen
 * exists to prevent.
 */
export function buildInitialFormValues(
  parsed: ExtractionParsed,
  existingGroup: ExistingGroupValues,
  existingArrival: ExistingLegValues | null,
  existingDeparture: ExistingLegValues | null,
  confidence: unknown = null,
): ReviewFormValues {
  return initialValuesFrom(
    buildFieldStates(parsed, existingGroup, existingArrival, existingDeparture, confidence),
  )
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

// ---------------------------------------------------------------------
// Save guards
// ---------------------------------------------------------------------

/**
 * Fields we blanked for low confidence that the reviewer has neither filled
 * in nor consciously left alone.
 *
 * `acknowledged` holds the keys the reviewer explicitly ticked "not heard —
 * leave as is" on. Blocking on this is what turns "not heard clearly" from a
 * colour into a decision: the alternative is a caller scrolling past a red
 * box and saving anyway.
 */
export function detectUnresolvedUnclear(
  values: ReviewFormValues,
  states: FieldStates,
  acknowledged: ReadonlySet<string>,
): FieldState[] {
  return (Object.keys(states) as FieldKey[])
    .map((key) => states[key])
    .filter(
      (state) =>
        state.band === 'unclear' &&
        normalize(getFormValue(values, state.key)) === null &&
        !acknowledged.has(state.key),
    )
}

/**
 * A `confirmed` RSVP with no head count.
 *
 * Room allocation and vehicle fitting both divide by PAX, so a family marked
 * confirmed with an unknown count silently breaks two later phases. Caught
 * here rather than at allocation time, when the family is unreachable.
 */
export function detectMissingConfirmedPax(values: ReviewFormValues): boolean {
  if (normalize(values.rsvpStatus) !== 'confirmed') return false
  return parseIntOrNull(values.confirmedPax) === null
}
