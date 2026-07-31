/**
 * Canonical phone-number handling for the whole app.
 *
 * There used to be two of these — a strict one in the Excel importer and a
 * lenient one on the call screen that truncated to the last 10 digits and
 * then unconditionally dialled `+91`. That combination could dial a
 * completely unrelated Indian number for an overseas relative, silently.
 * There is now exactly one normaliser, and it REJECTS rather than truncates.
 *
 * Pure, browser-safe, no dependencies: imported by client components, by the
 * import pipeline (both in the browser and inside server actions), and by
 * server components.
 */

export interface MobileResult {
  /** Exactly 10 digits (an Indian mobile), or null if it could not be reduced to that. */
  value: string | null
  /** Human-readable reason, set only when `value` is null and the cell was non-blank. */
  reason: string | null
}

/**
 * Strip spaces/dashes/brackets/dots, a leading +91 or 0 country/trunk
 * prefix, and the trailing ".0" Excel's number formatting leaves on a
 * mobile number that was stored as a numeric cell.
 *
 * Anything that does not reduce to exactly 10 digits comes back as
 * `{ value: null, reason }` — never as a truncated guess.
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

/** The 10-digit Indian mobile, or null. Never a truncated guess. */
export function normalisedMobile(raw: unknown): string | null {
  return normaliseMobile(raw).value
}

/**
 * "98765 43210" for display. A value that will not normalise is shown
 * VERBATIM rather than reformatted — a mangled number must look mangled, not
 * look like a valid Indian mobile.
 */
export function formatMobile(raw: string | null | undefined): string {
  const digits = normalisedMobile(raw)
  if (digits) return `${digits.slice(0, 5)} ${digits.slice(5)}`

  const trimmed = (raw ?? '').trim()
  return trimmed || '—'
}

/** An explicitly international number: stored with a leading +, 8-15 digits. */
const INTERNATIONAL = /^\+\s*(\d[\d\s\-().]{6,20})$/

export interface DialTarget {
  /**
   * Exactly what gets dialled, and what is written to
   * `call_attempts.dialed_number`. 10 digits for an Indian mobile, or
   * `+<digits>` for a stored international number.
   */
  dialedNumber: string
  /** The `tel:` URL. */
  href: string
  /** Display form. */
  label: string
  /** True when this is not a plain Indian mobile — the UI should say so. */
  international: boolean
}

/**
 * Resolve a stored mobile into something dialable, or null.
 *
 * Two cases only, deliberately:
 *  - reduces to 10 Indian digits -> `tel:+91XXXXXXXXXX`
 *  - was stored with an explicit `+` country code -> dial exactly that
 *
 * Anything else (a mangled 14-digit cell, a "9876543210 / 9876543211" pair)
 * returns null so the screen says "no dialable number" instead of inventing
 * one. This is the fix for the old `digits.slice(-10)` behaviour.
 */
export function dialTarget(raw: string | null | undefined): DialTarget | null {
  if (!raw) return null

  const indian = normalisedMobile(raw)
  if (indian) {
    return {
      dialedNumber: indian,
      href: `tel:+91${indian}`,
      label: `${indian.slice(0, 5)} ${indian.slice(5)}`,
      international: false,
    }
  }

  const match = INTERNATIONAL.exec(raw.trim())
  if (match) {
    const digits = match[1].replace(/\D/g, '')
    if (digits.length >= 7 && digits.length <= 15) {
      return {
        dialedNumber: `+${digits}`,
        href: `tel:+${digits}`,
        label: `+${digits}`,
        international: true,
      }
    }
  }

  return null
}

/** `tel:` URL for a stored number, or null when there is nothing dialable. */
export function telHref(raw: string | null | undefined): string | null {
  return dialTarget(raw)?.href ?? null
}
