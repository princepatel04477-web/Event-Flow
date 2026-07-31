/**
 * Phone helpers for the call screen. `guest_groups.primary_mobile` /
 * `alt_mobile` are stored normalised (10 digits, no +91) per the schema
 * guide, but real data is messy — every function here is defensive about
 * that rather than trusting it.
 */

/** Strip everything but digits, then keep the last 10 — mirrors the import normaliser. */
export function normalizeMobile(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length < 10) return null
  return digits.slice(-10)
}

/** "98765 43210" for display. Falls back to the raw value if it will not normalise. */
export function formatMobile(raw: string | null | undefined): string {
  const digits = normalizeMobile(raw)
  if (!digits) return raw ?? '—'
  return `${digits.slice(0, 5)} ${digits.slice(5)}`
}

/** `tel:+91XXXXXXXXXX`, or null when there is nothing dialable on file. */
export function telHref(raw: string | null | undefined): string | null {
  const digits = normalizeMobile(raw)
  if (!digits) return null
  return `tel:+91${digits}`
}
