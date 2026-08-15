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
 * A number rendered in scientific notation, as text: "9.425155093E9",
 * "9.42516E+09". Excel does this to any numeric cell whose column is too
 * narrow, and CSV/clipboard exports bake the rendering in permanently.
 */
const EXPONENTIAL_TEXT = /^[+-]?(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/

/**
 * Expand an exponential-notation string to its digits — but ONLY when the
 * mantissa carries at least as many significant digits as the expanded number
 * has, i.e. when the rendering was lossless.
 *
 * "9.425155093E9" -> "9425155093": mantissa has all 10 digits, so this is the
 * same number, just displayed badly.
 *
 * "9.42516E+09"   -> rejected: Number() would happily return 9425160000, a
 * real, dialable, WRONG Indian mobile. Excel threw four digits away when it
 * rendered the cell and nothing can bring them back. A blank number costs a
 * caller one lookup; a plausible wrong number gets a stranger dialled at
 * 9pm and an RSVP logged against the wrong family.
 */
function expandExponential(s: string): { digits: string } | { lossy: true } {
  const m = EXPONENTIAL_TEXT.exec(s)
  if (!m) return { lossy: true }

  const value = Number(s)
  if (!Number.isSafeInteger(value)) return { lossy: true }

  const mantissaDigits = `${m[1]}${m[2] ?? ''}`.replace(/^0+/, '').length
  const expanded = Math.abs(value).toString()
  if (mantissaDigits < expanded.length) return { lossy: true }

  return { digits: expanded }
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
    // A double big enough to have lost integer precision cannot be trusted to
    // still be the number that was typed in. 10- and 12-digit mobiles are
    // ~1e10, nowhere near 2^53, so this only ever fires on garbage.
    if (!Number.isSafeInteger(Math.trunc(raw))) {
      return { value: null, reason: `too large to be a phone number (${raw})` }
    }
    // Excel stores phone numbers as doubles; a genuine 10-digit number never
    // has a real fractional part, so truncate rather than round.
    s = Math.trunc(raw).toString()
  } else {
    s = String(raw).trim()
  }

  if (!s) return { value: null, reason: null }

  const original = s

  if (EXPONENTIAL_TEXT.test(s)) {
    const expanded = expandExponential(s)
    if ('lossy' in expanded) {
      return {
        value: null,
        reason: `is in exponential form ("${original}") and has lost digits — retype it in the sheet as text`,
      }
    }
    s = expanded.digits
  }

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

/**
 * A Google Maps directions deep link between two free-text points (§5.7).
 * Plain link, no API, no dependency. Returns null when neither point is
 * usable — a link with an empty origin/destination is worse than none.
 */
export function mapsDirectionsHref(
  origin: string | null | undefined,
  destination: string | null | undefined,
): string | null {
  const from = origin?.trim()
  const to = destination?.trim()
  if (!from && !to) return null
  const params = new URLSearchParams({ api: '1' })
  if (from) params.set('origin', from)
  if (to) params.set('destination', to)
  return `https://www.google.com/maps/dir/?${params.toString()}`
}

/**
 * `wa.me` deep link for a stored number, or null when there is nothing
 * messageable.
 *
 * Built on `dialTarget` so it inherits the same refusal to guess: a cell that
 * will not reduce to a real number gets null, and the UI renders a disabled
 * button. Opening a WhatsApp chat with a stranger is the same failure as
 * dialling one, and it is worse in one respect — the message can be sent
 * before anyone notices the name at the top is wrong.
 *
 * wa.me wants the full international number with no `+` and no separators:
 * an Indian mobile becomes `91XXXXXXXXXX`.
 */
export function whatsappHref(raw: string | null | undefined): string | null {
  const target = dialTarget(raw)
  if (!target) return null

  const digits = target.international
    ? target.dialedNumber.slice(1) // stored as +<cc><number>
    : `91${target.dialedNumber}`

  return `https://wa.me/${digits}`
}
