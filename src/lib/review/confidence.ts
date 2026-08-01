/**
 * Reading `rsvp_extractions.confidence` — a flat, dotted-path map like
 * `{"rsvp_status": 0.95, "arrival.date": 0.71}`. See
 * eventflow/Pipelines/Extraction Contract.md.
 *
 * Dependency-free, same rationale as payload.ts: this runs in a client
 * component and must stay unit-testable without a DOM or a Supabase client.
 */

/** >= this is trusted enough to pre-fill silently. */
export const CONFIDENCE_OK = 0.85
/** >= this (and below OK) is pre-filled, but flagged for a second look. */
export const CONFIDENCE_CHECK = 0.6

/**
 * How much we trust one extracted field.
 *
 * - `ok`      — pre-fill, render normally.
 * - `check`   — pre-fill, amber, "check this".
 * - `unclear` — do NOT pre-fill. Red, "not heard clearly", blocks save until
 *               the reviewer types a value or explicitly leaves it alone.
 * - `absent`  — the model said nothing about this field at all. Not a
 *               judgement about audio quality, so it gets no colouring.
 */
export type ConfidenceBand = 'ok' | 'check' | 'unclear' | 'absent'

/** Maps a review-form field key to the dotted confidence path the model emits. */
export const CONFIDENCE_PATHS: Record<string, string> = {
  rsvpStatus: 'rsvp_status',
  confirmedPax: 'confirmed_pax',
  // The model's key is `special_requests`; that is what confidence is keyed
  // under too, even though the RPC payload calls the same field `remarks`.
  remarks: 'special_requests',
  'arrival.mode': 'arrival.mode',
  'arrival.date': 'arrival.date',
  'arrival.time': 'arrival.time',
  'arrival.reference': 'arrival.reference',
  'arrival.point': 'arrival.point',
  'arrival.pax': 'arrival.pax',
  'departure.mode': 'departure.mode',
  'departure.date': 'departure.date',
  'departure.time': 'departure.time',
  'departure.reference': 'departure.reference',
  'departure.point': 'departure.point',
  'departure.pax': 'departure.pax',
}

/**
 * Reads a dotted path out of a confidence map. Tries the literal dotted key
 * first — that is how the contract actually stores it — then falls back to
 * walking nested objects in case an extraction ever nests it instead.
 */
export function getConfidence(confidence: unknown, path: string): number | null {
  if (!confidence || typeof confidence !== 'object' || Array.isArray(confidence)) return null
  const map = confidence as Record<string, unknown>

  if (path in map && typeof map[path] === 'number') return map[path] as number

  let cur: unknown = confidence
  for (const part of path.split('.')) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return null
    cur = (cur as Record<string, unknown>)[part]
  }
  return typeof cur === 'number' ? cur : null
}

/**
 * Band for one field.
 *
 * `hasExtractedValue` is what separates "the model tried and we could not
 * hear it" from "the call never covered this". A missing confidence score
 * next to a value the model *did* emit is the dangerous case — an unbacked
 * guess — and is treated as `unclear`. A missing score next to no value at
 * all is simply a field nobody discussed: it stays `absent`, uncoloured, and
 * pre-fills from the group's existing record as usual.
 *
 * Without that split, a call that only covered arrival would paint every
 * departure field red, and red would stop meaning anything.
 */
export function bandFor(
  confidence: unknown,
  path: string,
  hasExtractedValue: boolean,
): ConfidenceBand {
  const value = getConfidence(confidence, path)

  if (value === null) return hasExtractedValue ? 'unclear' : 'absent'
  if (value >= CONFIDENCE_OK) return 'ok'
  if (value >= CONFIDENCE_CHECK) return 'check'
  return 'unclear'
}

/** True when the band means "do not pre-fill this input". */
export function isUnclear(band: ConfidenceBand): boolean {
  return band === 'unclear'
}

export interface ConfidenceSummary {
  lowest: number | null
  /** Fields scoring below `CONFIDENCE_OK` — amber and red together. */
  flaggedCount: number
  /** Fields scoring below `CONFIDENCE_CHECK` — red only. */
  unclearCount: number
  total: number
}

/** Used on the review list to badge each row before the reviewer opens it. */
export function summarizeConfidence(confidence: unknown): ConfidenceSummary {
  if (!confidence || typeof confidence !== 'object' || Array.isArray(confidence)) {
    return { lowest: null, flaggedCount: 0, unclearCount: 0, total: 0 }
  }

  const values = Object.values(confidence as Record<string, unknown>).filter(
    (v): v is number => typeof v === 'number',
  )
  if (values.length === 0) return { lowest: null, flaggedCount: 0, unclearCount: 0, total: 0 }

  return {
    lowest: Math.min(...values),
    flaggedCount: values.filter((v) => v < CONFIDENCE_OK).length,
    unclearCount: values.filter((v) => v < CONFIDENCE_CHECK).length,
    total: values.length,
  }
}
