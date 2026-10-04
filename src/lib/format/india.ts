/**
 * The `en-IN` / `Asia/Kolkata` formatters.
 *
 * One place for the formats in `docs/COPY-INDIA.md` §3, so a screen never
 * hand-rolls a date or a rupee amount again. Pure and `Intl`-only: no
 * dependency, no `server-only`, so both the server and the client can import
 * it.
 *
 * The event happens in India, so every value is formatted in IST regardless
 * of the phone's own timezone — a coordinator checking the list from Dubai
 * must still read the same "10:30 AM" the driver reads in Surat.
 */

const TZ = 'Asia/Kolkata'

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const DAY = new Intl.DateTimeFormat('en-IN', { day: '2-digit', timeZone: TZ })
const MONTH = new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: TZ })
const WEEKDAY = new Intl.DateTimeFormat('en-IN', { weekday: 'short', timeZone: TZ })
const YEAR = new Intl.DateTimeFormat('en-IN', { year: 'numeric', timeZone: TZ })
const CLOCK = new Intl.DateTimeFormat('en-IN', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: TZ,
})

const day = (d: Date) => DAY.format(d)
const month = (d: Date) => MONTH.format(d)
const weekday = (d: Date) => WEEKDAY.format(d)

/** "20 Dec (Sat)" — empty string for a missing or unparseable value. */
export function formatDate(value: string | number | Date | null | undefined): string {
  const d = toDate(value)
  return d ? `${day(d)} ${month(d)} (${weekday(d)})` : ''
}

/** "20 Dec (Sat) 2027" — the year is added only when it is not this year. */
export function formatDateWithYear(value: string | number | Date | null | undefined, now = new Date()): string {
  const d = toDate(value)
  if (!d) return ''
  const base = formatDate(d)
  return YEAR.format(d) === YEAR.format(now) ? base : `${base} ${YEAR.format(d)}`
}

/** "10:30 AM". */
export function formatTime(value: string | number | Date | null | undefined): string {
  const d = toDate(value)
  if (!d) return ''
  return CLOCK.format(d).replace(/\b(am|pm)\b/i, (m) => m.toUpperCase())
}

/** "20 Dec, 10:30 AM". */
export function formatDateTime(value: string | number | Date | null | undefined): string {
  const d = toDate(value)
  return d ? `${day(d)} ${month(d)}, ${formatTime(d)}` : ''
}

/** "₹1,25,000" — Indian lakh grouping, no decimals. */
export function formatRupees(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return ''
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value)
}

/** "+91 98765 43210" — a 10-digit number or a 12-digit one with the 91 in front. */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return ''
  const digits = value.replace(/\D/g, '')
  const ten = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits
  if (ten.length !== 10) return value.trim()
  return `+91 ${ten.slice(0, 5)} ${ten.slice(5)}`
}

/** "12/15 PAX", or "12 PAX" without a total. */
export function formatPax(value: number, total?: number | null): string {
  return total === undefined || total === null ? `${value} PAX` : `${value}/${total} PAX`
}
