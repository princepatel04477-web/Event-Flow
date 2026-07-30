/**
 * Small, dependency-free helpers shared by every screen.
 *
 * Keep this module pure and browser-safe — it is imported by client
 * components. Nothing here may touch `next/headers`, `server-only`, or
 * Supabase.
 */

export type ClassDictionary = Record<string, boolean | null | undefined>

export type ClassValue =
  | string
  | number
  | null
  | undefined
  | false
  | ClassValue[]
  | ClassDictionary

/**
 * clsx-style class joiner, written by hand so we do not add a dependency.
 *
 * It concatenates — it does NOT resolve Tailwind conflicts. Component props
 * are ordered so that a caller's `className` lands last, which is enough for
 * additive overrides. If you need to replace a base style rather than add to
 * it, pass the variant prop instead of fighting it with a class.
 */
export function cn(...inputs: ClassValue[]): string {
  const out: string[] = []
  collect(inputs, out)
  return out.join(' ')
}

function collect(value: ClassValue, out: string[]): void {
  if (value === null || value === undefined || value === false || value === '') {
    return
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed) out.push(trimmed)
    return
  }

  if (typeof value === 'number') {
    out.push(String(value))
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) collect(item, out)
    return
  }

  for (const key of Object.keys(value)) {
    if (value[key]) out.push(key)
  }
}

/**
 * Sanitise a `?next=` value before we redirect to it.
 *
 * Only same-origin absolute paths survive. Anything else — a full URL, a
 * protocol-relative `//evil.example`, a backslash trick — collapses to the
 * fallback. This is the open-redirect guard for /login and /auth/callback.
 */
export function safeRedirectPath(
  value: FormDataEntryValue | string | null | undefined,
  fallback = '/',
): string {
  if (typeof value !== 'string') return fallback

  const candidate = value.trim()
  if (!candidate.startsWith('/')) return fallback
  // `//host` and `/\host` are both treated as protocol-relative by browsers.
  if (candidate.startsWith('//') || candidate.startsWith('/\\')) return fallback
  if (candidate.includes('\n') || candidate.includes('\r')) return fallback

  return candidate
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * Format a Postgres `date` (always `YYYY-MM-DD`) for display.
 *
 * Parsed as UTC and formatted as UTC on purpose: `new Date('2026-12-20')` is
 * midnight UTC, and rendering that in a negative-offset timezone silently
 * shows the previous day.
 */
export function formatDate(
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' },
): string | null {
  if (!value) return null

  const match = DATE_ONLY.exec(value)
  if (!match) return null

  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  )
  if (Number.isNaN(date.getTime())) return null

  return new Intl.DateTimeFormat('en-IN', {
    ...options,
    timeZone: 'UTC',
  }).format(date)
}

/** "20 Dec – 24 Dec 2026", or whichever half of that we actually have. */
export function formatDateRange(
  startsOn: string | null | undefined,
  endsOn: string | null | undefined,
): string | null {
  const start = formatDate(startsOn)
  const end = formatDate(endsOn, { day: 'numeric', month: 'short', year: 'numeric' })

  if (start && end) return `${start} – ${end}`
  if (start) return formatDate(startsOn, { day: 'numeric', month: 'short', year: 'numeric' })
  return end
}

/** Counters come back from views as `number | null`. Render 0, never "null". */
export function count(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Group numbers so 1,234 stays readable at a glance on a small screen. */
export function formatCount(value: number | null | undefined): string {
  return new Intl.NumberFormat('en-IN').format(count(value))
}
