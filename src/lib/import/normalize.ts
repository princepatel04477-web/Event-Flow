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

// Mobile normalisation is shared with the call screen — one implementation,
// in @/lib/phone. Re-exported here so import-pipeline callers keep reading as
// one module.
export { normaliseMobile, type MobileResult } from '@/lib/phone'

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

/**
 * The only three RSVP states an import may produce.
 *
 * 'confirmed' is deliberately absent and this is not an oversight: a
 * confirmation comes from a reviewed phone call and nothing else. Ringing
 * these 238 families IS Phase 1 — an import that pre-confirmed them would
 * delete the work rather than schedule it. Anything that maps a sheet cell to
 * 'confirmed' is a bug.
 */
export type ImportRsvpStatus = 'not_started' | 'declined' | 'tentative'

/**
 * `Remark` -> rsvp_status for the KNOWN CALLING_MASTER_LIST layout.
 *
 * Exactly two rules, both substring, both case-insensitive:
 *   "not coming" -> declined
 *   "not sure"   -> tentative
 *   anything else -> not_started
 *
 * Narrower on purpose than `rsvpFromRemarks` above, which serves the unknown-
 * sheet fallback path where the remarks column could be anything and a fuzzy
 * guess is the best available. Here the vocabulary is known, and the cost of
 * over-matching is asymmetric: a false 'declined' quietly drops a family off
 * the calling queue and nobody notices until they arrive at the venue. So
 * "cancelled", "maybe", "won't attend" and friends stay 'not_started' — the
 * remark itself is still imported, and the caller reads it before dialling.
 */
export function importRsvpStatus(remark: unknown): ImportRsvpStatus {
  if (remark === null || remark === undefined) return 'not_started'
  const s = String(remark).trim().toLowerCase()
  if (!s) return 'not_started'

  if (/not\s*coming/.test(s)) return 'declined'
  if (/not\s*sure/.test(s)) return 'tentative'

  return 'not_started'
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
export type SubSide = 'father' | 'mother'

export interface ParsedSideInfo {
  side: NormalisedSide | null
  subSide: SubSide | null
}

function parseShorthandSide(token: string): ParsedSideInfo | null {
  switch (token) {
    case 'gf':
    case 'groom father':
    case "groom's father":
    case 'grooms father':
    case 'groom father side':
    case "groom's father side":
      return { side: 'groom', subSide: 'father' }
    case 'gm':
    case 'groom mother':
    case "groom's mother":
    case 'grooms mother':
    case 'groom mother side':
    case "groom's mother side":
      return { side: 'groom', subSide: 'mother' }
    case 'bf':
    case 'bride father':
    case "bride's father":
    case 'brides father':
    case 'bride father side':
    case "bride's father side":
      return { side: 'bride', subSide: 'father' }
    case 'bm':
    case 'bride mother':
    case "bride's mother":
    case 'brides mother':
    case 'bride mother side':
    case "bride's mother side":
      return { side: 'bride', subSide: 'mother' }
    default:
      return null
  }
}

export function normaliseSide(raw: unknown): NormalisedSide | null {
  const s = normaliseText(raw)?.toLowerCase()
  if (!s) return null
  const shorthand = parseShorthandSide(s)
  if (shorthand) return shorthand.side
  const hasBride = /\bbride/.test(s) || s.includes('bride')
  const hasGroom = /\bgroom/.test(s) || s.includes('groom')
  if (s.includes('both') || (hasBride && hasGroom)) return 'both'
  if (hasBride) return 'bride'
  if (hasGroom) return 'groom'
  return 'other'
}

export function parseSubSide(raw: unknown): SubSide | null {
  const s = normaliseText(raw)?.toLowerCase()
  if (!s) return null
  const shorthand = parseShorthandSide(s)
  if (shorthand) return shorthand.subSide
  if (
    /\bfather(?:'?s)?\b/.test(s) ||
    /\bpaternal\b/.test(s) ||
    /\bdad\b/.test(s) ||
    /\bpapa\b/.test(s)
  ) {
    return 'father'
  }
  if (
    /\bmother(?:'?s)?\b/.test(s) ||
    /\bmaternal\b/.test(s) ||
    /\bmom\b/.test(s) ||
    /\bmummy\b/.test(s) ||
    /\bmama\b/.test(s)
  ) {
    return 'mother'
  }
  return null
}

/**
 * Resolve both primary side (`groom` / `bride` / `both` / `other`) and
 * family branch (`father` / `mother`) from separate or combined cells.
 *
 * Accepts either two columns ("Groom" + "Father's Side") or a single
 * combined string ("Groom's Father Side", "Bride Mother", "GF", etc.).
 */
export function parseSideAndSubSide(rawSide: unknown, rawSubSide?: unknown): ParsedSideInfo {
  const sideText = normaliseText(rawSide)?.toLowerCase() ?? null
  const subText = normaliseText(rawSubSide)?.toLowerCase() ?? null

  const shorthandFromSide = sideText ? parseShorthandSide(sideText) : null
  const shorthandFromSub = subText ? parseShorthandSide(subText) : null

  const explicitSide =
    (sideText ? normaliseSide(sideText) : null) ??
    shorthandFromSub?.side ??
    (subText ? inferPrimarySideIfExplicit(subText) : null)

  const explicitSub =
    (subText ? parseSubSide(subText) : null) ??
    (sideText ? parseSubSide(sideText) : null) ??
    shorthandFromSide?.subSide ??
    null

  if (explicitSide === 'both' || explicitSide === 'other') {
    return { side: explicitSide, subSide: null }
  }

  return {
    side: explicitSide,
    subSide: explicitSub,
  }
}

function inferPrimarySideIfExplicit(s: string): NormalisedSide | null {
  if (s.includes('both')) return 'both'
  if (s.includes('bride')) return 'bride'
  if (s.includes('groom')) return 'groom'
  return null
}

/**
 * Merge row-level side / sub-side cells with import-level defaults.
 *
 * Row values always win over import-level defaults, and a default sub-side
 * is only inherited when the resolved primary side matches the default side
 * (or no default primary side was specified), preventing e.g. Groom's Father
 * from leaking onto an explicit Bride row.
 */
export function resolveImportedSide(
  rawSide: unknown,
  rawSubSide: unknown,
  defaultSide?: NormalisedSide | null,
  defaultSubSide?: SubSide | null,
): ParsedSideInfo {
  const rowParsed = parseSideAndSubSide(rawSide, rawSubSide)
  const side = rowParsed.side ?? defaultSide ?? null
  let subSide: SubSide | null = rowParsed.subSide
  if (
    subSide === null &&
    defaultSubSide != null &&
    (side === 'groom' || side === 'bride') &&
    (defaultSide == null || side === defaultSide)
  ) {
    subSide = defaultSubSide
  }
  if (side === 'both' || side === 'other') {
    subSide = null
  }
  return { side, subSide }
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
