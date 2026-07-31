/**
 * Cell-level normalisation for Excel import.
 *
 * Every function here is pure and side-effect free so it can run in the
 * browser (building the preview) and again inside the server action
 * (re-deriving values from the same payload) without drift.
 *
 * A `null` result generally means "unmapped or genuinely blank cell" and,
 * on commit, leaves any existing database value alone (coalesce semantics -
 * the same convention `apply_rsvp_extraction()` uses). A non-null result
 * that still looks wrong (e.g. an unresolvable mobile number) is surfaced
 * as a *warning*, never a silent drop - the family still gets imported.
 */

export interface MobileResult {
  /** Exactly 10 digits, or null if it could not be reduced to that. */
  value: string | null
  /** Human-readable reason, set only when `value` is null and the cell was non-blank. */
  reason: string | null
}

/**
 * Strip spaces/dashes/brackets/dots, a leading +91 or 0 country/trunk
 * prefix, and the trailing ".0" Excel's number formatting leaves on a
 * mobile number that was stored as a numeric cell.
 */
export function normaliseMobile(raw: unknown): MobileResult {
  if (raw === null || raw === undefined) {
    return { value: null, reason: null }
  }

  let s: string
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { value: null, reason: 'not a number' }
    // Excel stores phone numbers as doubles; a genuine 10-digit number never
    // has a real fractional part, so truncate rather than round.
    s = Math.trunc(raw).toString()
  } else {
    s = String(raw).trim()
  }

  if (!s) return { value: null, reason: null }

  const original = s

  // A text cell exported from Excel can carry a literal ".0" / ".00".
  s = s.replace(/\.0+$/, '')

  // Now strip everything that isn't a digit: spaces, dashes, brackets, +.
  s = s.replace(/\D/g, '')

  if (!s) {
    return { value: null, reason: `no digits found in "${original}"` }
  }

  // Country code, with or without the + (already stripped above).
  if (s.length === 12 && s.startsWith('91')) s = s.slice(2)
  else if (s.length === 13 && s.startsWith('091')) s = s.slice(3)

  // A single leading trunk zero.
  if (s.length === 11 && s.startsWith('0')) s = s.slice(1)

  if (/^\d{10}$/.test(s)) {
    return { value: s, reason: null }
  }

  return {
    value: null,
    reason: `does not reduce to 10 digits ("${original}" -> "${s}")`,
  }
}

/** "6", "6 pax", "six", "", null -> number | null. Never zero or negative. */
export function parsePax(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) return null
    return Math.round(raw)
  }

  const s = String(raw).trim().toLowerCase()
  if (!s) return null

  const digitMatch = s.match(/\d+/)
  if (digitMatch) {
    const n = Number(digitMatch[0])
    return Number.isFinite(n) && n > 0 ? n : null
  }

  const WORDS: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  }

  for (const [word, n] of Object.entries(WORDS)) {
    if (s.includes(word)) return n
  }

  return null
}

export type RemarksRsvpHint = 'declined' | 'tentative' | null

/**
 * Detects an RSVP outcome hiding in free-text remarks, e.g. "Not Coming" or
 * "Not Sure" buried in a column meant for something else. Case-insensitive.
 * This is a hint for the preview screen only - it never writes rsvp_status
 * itself, that stays `not_started` until a real call happens.
 */
export function rsvpFromRemarks(remarks: unknown): RemarksRsvpHint {
  if (remarks === null || remarks === undefined) return null
  const s = String(remarks).trim().toLowerCase()
  if (!s) return null

  if (/not\s*coming|won'?t\s*(be\s*)?(coming|attend)|declin(e|ed|es|ing)|cancel+ed/.test(s)) {
    return 'declined'
  }

  if (/not\s*sure|maybe|tentativ|might\s*come|unconfirmed/.test(s)) {
    return 'tentative'
  }

  return null
}

/** Trims to null-or-non-empty-string. Casing is preserved for display. */
export function normaliseText(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  const s = String(raw).trim()
  return s ? s : null
}

export type NormalisedGroupType = 'family' | 'couple' | 'friends' | 'single'

/** Casing-insensitive so "Family", "FAMILY" and "family" all agree. */
export function normaliseGroupType(raw: unknown): NormalisedGroupType | null {
  const s = normaliseText(raw)?.toLowerCase()
  if (!s) return null
  if (s.includes('coup')) return 'couple'
  if (s.includes('friend')) return 'friends'
  if (s.includes('single') || s.includes('individual')) return 'single'
  if (s.includes('fam')) return 'family'
  return null
}

export type NormalisedSide = 'bride' | 'groom' | 'both' | 'other'

export function normaliseSide(raw: unknown): NormalisedSide | null {
  const s = normaliseText(raw)?.toLowerCase()
  if (!s) return null
  if (s.includes('both')) return 'both'
  if (s.includes('bride')) return 'bride'
  if (s.includes('groom')) return 'groom'
  return 'other'
}

/**
 * Returns null (not false!) when the cell is blank or unmapped, so an
 * import never has an opinion strong enough to clear a flag a staff member
 * set later in the app. Only an explicit yes/no-shaped cell resolves.
 */
export function normaliseBoolean(raw: unknown): boolean | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'number') return raw !== 0

  const s = String(raw).trim().toLowerCase()
  if (!s) return null

  if (['y', 'yes', 'true', '1', 'needed', 'required', 'req'].includes(s)) return true
  if (['n', 'no', 'false', '0', 'not needed', 'na', 'n/a', 'none'].includes(s)) return false

  return null
}
