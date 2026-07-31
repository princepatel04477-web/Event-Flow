/**
 * Reading `rsvp_extractions.confidence` — a flat, dotted-path map like
 * `{"rsvp_status": 0.95, "arrival.date": 0.71}`. See
 * eventflow/Pipelines/Extraction Contract.md.
 *
 * Dependency-free, same rationale as payload.ts.
 */

export const LOW_CONFIDENCE_THRESHOLD = 0.8

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

export function isLowConfidence(confidence: unknown, path: string): boolean {
  const value = getConfidence(confidence, path)
  return value !== null && value < LOW_CONFIDENCE_THRESHOLD
}

export interface ConfidenceSummary {
  lowest: number | null
  lowCount: number
  total: number
}

/** Used on the review list to badge each row before the reviewer opens it. */
export function summarizeConfidence(confidence: unknown): ConfidenceSummary {
  if (!confidence || typeof confidence !== 'object' || Array.isArray(confidence)) {
    return { lowest: null, lowCount: 0, total: 0 }
  }

  const values = Object.values(confidence as Record<string, unknown>).filter(
    (v): v is number => typeof v === 'number',
  )
  if (values.length === 0) return { lowest: null, lowCount: 0, total: 0 }

  const lowest = Math.min(...values)
  const lowCount = values.filter((v) => v < LOW_CONFIDENCE_THRESHOLD).length
  return { lowest, lowCount, total: values.length }
}
