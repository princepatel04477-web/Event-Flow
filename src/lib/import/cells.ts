/**
 * Cell cleaning for the known CALLING_MASTER_LIST layout.
 *
 * Everything in this file is a real defect observed in the actual workbook,
 * not defensive programming for hypotheticals: mobiles rendered as floats,
 * dates written as bare ordinals ("4TH"), times stored as Excel day
 * fractions, travel modes written as English prose, and nicknames in
 * brackets inside guest names.
 *
 * Every function is pure and side-effect free. The preview runs them in the
 * browser; the commit session re-runs them server-side on the same payload.
 * Drift between those two runs is how an import corrupts data, so nothing
 * here may read a clock, a locale, a database or the DOM.
 *
 * The governing rule for all of it: a value that cannot be resolved with
 * certainty comes back as null WITH a reason, and the caller keeps the raw
 * text and warns. Never invent a date, a time or a phone number.
 */

import type { Database } from '@/lib/supabase/database.types'

export type TravelMode = Database['app']['Enums']['travel_mode']

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

export function isBlankCell(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === ''
}

/** The raw cell as display text, for warnings and for `import_rows.raw`. */
export function rawCellText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  const s = String(value).trim()
  return s === '' ? null : s
}

/**
 * Builds the `{ header: cell }` record kept as the permanent copy of what the
 * sheet said. `import_rows` has no audit trigger (CLAUDE.md §10), so this is
 * the only record — it must lose nothing.
 *
 * Iterates the full width of headers AND cells, because sheet_to_json returns
 * ragged rows and a stray value past the last header is still real data, and
 * disambiguates repeated header text ("Time", "Mode", "Details" all appear
 * twice) instead of letting the second occurrence overwrite the first.
 */
export function rawRecord(headers: (string | null)[], cells: unknown[]): Record<string, unknown> {
  const raw: Record<string, unknown> = {}
  const seen = new Map<string, number>()
  const width = Math.max(headers.length, cells.length)

  for (let i = 0; i < width; i++) {
    const base = headers[i] ?? `column_${i + 1}`
    const occurrence = (seen.get(base) ?? 0) + 1
    seen.set(base, occurrence)
    const key = occurrence === 1 ? base : `${base} (${occurrence})`
    raw[key] = cells[i] ?? null
  }

  return raw
}

// ---------------------------------------------------------------------------
// names
// ---------------------------------------------------------------------------

export interface NameResult {
  /** Display name, ORIGINAL CASING preserved. */
  value: string | null
  /** The nickname that was removed, if any — kept so the change is visible. */
  removed: string | null
}

/**
 * "SUNITA (RITA) PATEL" -> "SUNITA PATEL".
 *
 * Casing is preserved deliberately: these names are read aloud by a caller
 * and shown to the client, and this sheet mixes ALL CAPS with Title Case in a
 * way that carries no meaning. Normalising it would only make the preview
 * disagree with the file the operator is looking at.
 *
 * An unclosed bracket ("SUNITA (RITA PATEL") is treated as a nickname running
 * to the end of the cell — the alternative is keeping a stray "(" in a name
 * that gets rendered on a room list.
 */
export function cleanPersonName(raw: unknown): NameResult {
  if (isBlankCell(raw)) return { value: null, removed: null }

  const original = String(raw)
  const removedParts: string[] = []

  let cleaned = original.replace(/[([{][^)\]}]*[)\]}]/g, (match) => {
    removedParts.push(match)
    return ' '
  })

  cleaned = cleaned.replace(/[([{][^)\]}]*$/g, (match) => {
    removedParts.push(match)
    return ' '
  })

  cleaned = cleaned.replace(/\s+/g, ' ').trim()

  if (!cleaned) {
    // The whole cell was a bracketed aside. Keep the original rather than
    // producing a nameless guest.
    return { value: original.replace(/\s+/g, ' ').trim(), removed: null }
  }

  return {
    value: cleaned,
    removed: removedParts.length > 0 ? removedParts.join(' ').replace(/\s+/g, ' ').trim() : null,
  }
}

// ---------------------------------------------------------------------------
// dates
// ---------------------------------------------------------------------------

export type DateWindowSource = 'event_dates' | 'event_start_month' | 'none'

export interface DateWindow {
  /** Every ISO date an ordinal day is allowed to resolve to, ascending. */
  dates: string[]
  /** How the window was derived — quoted verbatim in every date warning. */
  description: string
  source: DateWindowSource
}

const MS_PER_DAY = 86_400_000

/** Excel's day-zero. Serial 1 is 1900-01-01; serials above 60 use this epoch. */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30)

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function toUtc(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const ts = Date.UTC(y, mo - 1, d)
  // Rejects 2026-02-30 and friends: the round trip changes the day.
  const back = new Date(ts)
  if (back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null
  return ts
}

function isoFromUtc(ts: number): string {
  const d = new Date(ts)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** "20 Dec 2026" — used in warning text so the window is visible, not implied. */
export function formatIsoForHumans(iso: string): string {
  const ts = toUtc(iso)
  if (ts === null) return iso
  const d = new Date(ts)
  return `${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** Days 3-8 is this wedding's window; deriving it from the event row gives the
 *  same answer here and the right answer for the next event. */
const FALLBACK_FIRST_DAY = 3
const FALLBACK_LAST_DAY = 8

/** A window longer than this is almost certainly bad event data, not a long
 *  wedding — enumerating it would make every ordinal ambiguous anyway. */
const MAX_WINDOW_DAYS = 92

/**
 * Builds the set of calendar dates a bare ordinal ("4TH") may resolve to.
 *
 * - both event dates present -> every date from starts_on to ends_on
 * - only starts_on           -> days 3-8 of the month starts_on falls in
 * - neither                  -> no window; ordinals stay raw text
 *
 * `events.starts_on` and `events.ends_on` are both nullable (schema fact), so
 * all three cases are real. The parser takes these as INPUTS — it never reads
 * the database itself, which is what keeps it pure and testable and what lets
 * the browser preview and the server commit produce byte-identical results.
 */
export function buildDateWindow(
  startsOn: string | null | undefined,
  endsOn: string | null | undefined,
): DateWindow {
  const start = startsOn ? toUtc(startsOn) : null
  const end = endsOn ? toUtc(endsOn) : null

  if (start === null) {
    return {
      dates: [],
      description:
        'no window — this event has no start date, so an ordinal like "4TH" cannot be turned into a calendar date',
      source: 'none',
    }
  }

  if (end !== null && end >= start) {
    const span = Math.round((end - start) / MS_PER_DAY) + 1
    if (span <= MAX_WINDOW_DAYS) {
      const dates: string[] = []
      for (let i = 0; i < span; i++) dates.push(isoFromUtc(start + i * MS_PER_DAY))
      return {
        dates,
        description: `${formatIsoForHumans(dates[0])} – ${formatIsoForHumans(
          dates[dates.length - 1],
        )} (the event dates)`,
        source: 'event_dates',
      }
    }
  }

  // starts_on only (or an end date that is before the start, or absurdly far
  // after it — in both cases the end date is not usable).
  const s = new Date(start)
  const year = s.getUTCFullYear()
  const month = s.getUTCMonth()
  const dates: string[] = []
  for (let day = FALLBACK_FIRST_DAY; day <= FALLBACK_LAST_DAY; day++) {
    const ts = Date.UTC(year, month, day)
    if (new Date(ts).getUTCMonth() === month) dates.push(isoFromUtc(ts))
  }

  return {
    dates,
    description: `${formatIsoForHumans(dates[0])} – ${formatIsoForHumans(
      dates[dates.length - 1],
    )} (days ${FALLBACK_FIRST_DAY}–${FALLBACK_LAST_DAY} of ${
      MONTH_SHORT[month]
    } ${year}, because this event has no end date)`,
    source: 'event_start_month',
  }
}

export interface DateCellResult {
  /** ISO `YYYY-MM-DD` for `travel_legs.travel_date`, or null. */
  value: string | null
  /** The cell exactly as it was, kept whenever `value` is null. */
  rawText: string | null
  /** Why it was not resolved. Always names the window that was used. */
  reason: string | null
}

function resolveOrdinalDay(day: number, window: DateWindow, rawText: string): DateCellResult {
  if (window.source === 'none') {
    return {
      value: null,
      rawText,
      reason: `"${rawText}" reads as day ${day}, but there is ${window.description}`,
    }
  }

  const matches = window.dates.filter((iso) => Number(iso.slice(8, 10)) === day)

  if (matches.length === 1) return { value: matches[0], rawText, reason: null }

  if (matches.length === 0) {
    return {
      value: null,
      rawText,
      reason: `"${rawText}" reads as day ${day}, which is outside ${window.description}, so the raw text was kept`,
    }
  }

  return {
    value: null,
    rawText,
    reason: `"${rawText}" reads as day ${day}, which falls on ${matches
      .map(formatIsoForHumans)
      .join(' and ')} inside ${window.description}, so the raw text was kept`,
  }
}

function checkedFullDate(iso: string, window: DateWindow, rawText: string): DateCellResult {
  if (window.source === 'none' || window.dates.includes(iso)) {
    return { value: iso, rawText, reason: null }
  }
  return {
    value: null,
    rawText,
    reason: `reads as ${formatIsoForHumans(iso)}, which is outside ${window.description}, so the raw text was kept`,
  }
}

const ORDINAL = /^(\d{1,2})\s*(?:st|nd|rd|th)?\.?$/i
const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/
const NUMERIC_DATE = /^(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2}|\d{4}))?$/
const DAY_MONTH_NAME = /^(\d{1,2})\s*(?:st|nd|rd|th)?[\s,-]*([a-z]{3,9})\.?[\s,-]*(\d{2,4})?$/i
const MONTH_NAME_DAY = /^([a-z]{3,9})\.?[\s,-]*(\d{1,2})\s*(?:st|nd|rd|th)?[\s,-]*(\d{2,4})?$/i

function monthIndexFromName(name: string): number | null {
  const n = name.toLowerCase()
  const exact = MONTH_NAMES.indexOf(n)
  if (exact >= 0) return exact
  const prefix = MONTH_NAMES.findIndex((m) => m.startsWith(n) && n.length >= 3)
  return prefix >= 0 ? prefix : null
}

function fullYear(part: string | undefined, window: DateWindow): number | null {
  if (part === undefined) {
    if (window.dates.length === 0) return null
    return Number(window.dates[0].slice(0, 4))
  }
  const n = Number(part)
  if (!Number.isFinite(n)) return null
  return part.length === 2 ? 2000 + n : n
}

/**
 * Turns an "Arrival Date" / "Departure Date" cell into an ISO date.
 *
 * Handles, in order: a real Date, an Excel date serial, a bare ordinal
 * ("4", "4TH", "4th "), ISO text, d/m[/yy] text, and "4 Dec" / "Dec 4".
 *
 * d/m vs m/d is resolved AGAINST THE WINDOW, not by assuming a convention:
 * "4/12" is tried both ways and accepted only when exactly one reading lands
 * inside the event. A file that makes both readings valid keeps its raw text.
 */
export function parseEventDate(raw: unknown, window: DateWindow): DateCellResult {
  if (isBlankCell(raw)) return { value: null, rawText: null, reason: null }

  const rawText = rawCellText(raw) ?? ''

  if (raw instanceof Date) {
    const iso = isoFromUtc(Date.UTC(raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate()))
    return checkedFullDate(iso, window, rawText)
  }

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) {
      return { value: null, rawText, reason: 'is not a readable number, so the raw text was kept' }
    }
    const n = Math.trunc(raw)
    if (n >= 1 && n <= 31) return resolveOrdinalDay(n, window, rawText)
    // Excel date serials: 20000 is 1954, 80000 is 2119. Anything in between is
    // a real date cell that lost its formatting on the way out of Excel.
    if (n >= 20_000 && n <= 80_000) {
      return checkedFullDate(isoFromUtc(EXCEL_EPOCH_UTC + n * MS_PER_DAY), window, rawText)
    }
    return {
      value: null,
      rawText,
      reason: `"${rawText}" is not a day of the month or a date, so the raw text was kept`,
    }
  }

  const text = String(raw).trim()

  const ordinal = ORDINAL.exec(text)
  if (ordinal) {
    const day = Number(ordinal[1])
    if (day >= 1 && day <= 31) return resolveOrdinalDay(day, window, rawText)
  }

  const iso = ISO_DATE.exec(text)
  if (iso) {
    const ts = toUtc(`${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`)
    if (ts !== null) return checkedFullDate(isoFromUtc(ts), window, rawText)
  }

  const numeric = NUMERIC_DATE.exec(text)
  if (numeric) {
    const a = Number(numeric[1])
    const b = Number(numeric[2])
    const year = fullYear(numeric[3], window)
    if (year !== null) {
      const candidates: string[] = []
      // day/month (Indian convention) first, then month/day.
      for (const [d, m] of [
        [a, b],
        [b, a],
      ] as const) {
        if (m < 1 || m > 12 || d < 1 || d > 31) continue
        const ts = toUtc(`${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
        if (ts !== null) {
          const candidate = isoFromUtc(ts)
          if (!candidates.includes(candidate)) candidates.push(candidate)
        }
      }

      const inWindow = candidates.filter((c) => window.dates.includes(c))
      if (inWindow.length === 1) return { value: inWindow[0], rawText, reason: null }
      if (candidates.length === 1) return checkedFullDate(candidates[0], window, rawText)
      if (inWindow.length > 1) {
        return {
          value: null,
          rawText,
          reason: `"${rawText}" reads as both ${inWindow
            .map(formatIsoForHumans)
            .join(' and ')} inside ${window.description}, so the raw text was kept`,
        }
      }
      if (candidates.length > 1) {
        return {
          value: null,
          rawText,
          reason: `"${rawText}" reads as ${candidates
            .map(formatIsoForHumans)
            .join(' or ')}, neither inside ${window.description}, so the raw text was kept`,
        }
      }
    }
  }

  for (const [re, dayIndex, monthIndex] of [
    [DAY_MONTH_NAME, 1, 2],
    [MONTH_NAME_DAY, 2, 1],
  ] as const) {
    const m = re.exec(text)
    if (!m) continue
    const month = monthIndexFromName(m[monthIndex])
    const day = Number(m[dayIndex])
    const year = fullYear(m[3], window)
    if (month === null || year === null || !Number.isFinite(day)) continue
    const ts = toUtc(`${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
    if (ts !== null) return checkedFullDate(isoFromUtc(ts), window, rawText)
  }

  return {
    value: null,
    rawText,
    reason: `"${rawText}" could not be read as a date against ${window.description}, so the raw text was kept`,
  }
}

// ---------------------------------------------------------------------------
// times
// ---------------------------------------------------------------------------

export interface TimeCellResult {
  /** "HH:MM", 24-hour, for `travel_legs.travel_time`. */
  value: string | null
  rawText: string | null
  reason: string | null
}

/**
 * ROUNDING: Excel stores 11:00 as the day fraction 0.4583, and
 * 0.4583 * 24 = 10.9992 — truncating gives 10:59, an hour that never appeared
 * in the sheet and a caller waiting at the wrong minute. Every conversion here
 * therefore rounds to the NEAREST minute. The error a round can introduce is
 * at most 30 seconds; the error truncation introduces is a full minute, always
 * downward, and it lands exactly on the round hours that dominate this file.
 */
function minutesToHhMm(totalMinutes: number): string {
  const wrapped = ((Math.round(totalMinutes) % 1440) + 1440) % 1440
  const h = Math.floor(wrapped / 60)
  const m = wrapped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

const CLOCK_TEXT = /^(\d{1,2})\s*(?:[:.\s]\s*(\d{1,2}))?\s*(a\.?m\.?|p\.?m\.?)?\.?$/i
const HHMM_DIGITS = /^(\d{3,4})\s*(?:hrs?|hours?)?$/i

function applyMeridiem(hour: number, meridiem: string | undefined): number | null {
  if (!meridiem) return hour <= 23 ? hour : null
  const pm = /^p/i.test(meridiem)
  if (hour < 1 || hour > 12) return null
  if (pm) return hour === 12 ? 12 : hour + 12
  return hour === 12 ? 0 : hour
}

/** Excel day fraction, a real time value, or clock text -> "HH:MM". */
export function parseSheetTime(raw: unknown): TimeCellResult {
  if (isBlankCell(raw)) return { value: null, rawText: null, reason: null }

  const rawText = rawCellText(raw) ?? ''

  if (raw instanceof Date) {
    return { value: minutesToHhMm(raw.getUTCHours() * 60 + raw.getUTCMinutes()), rawText, reason: null }
  }

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) {
      return { value: null, rawText, reason: 'is not a readable number, so no time was set' }
    }

    const fraction = raw - Math.floor(raw)

    if (raw > 0 && raw < 1) {
      return { value: minutesToHhMm(fraction * 1440), rawText, reason: null }
    }

    if (fraction > 0) {
      // A date-time serial: the whole part is the date, the fraction the time.
      return { value: minutesToHhMm(fraction * 1440), rawText, reason: null }
    }

    // A whole number. 0 is Excel's "empty numeric cell" far more often than it
    // is midnight, so it is treated as no time rather than as 00:00.
    const n = Math.trunc(raw)
    if (n === 0) return { value: null, rawText, reason: null }
    if (n >= 1 && n <= 23) return { value: minutesToHhMm(n * 60), rawText, reason: null }
    if (n >= 100 && n <= 2359) {
      const h = Math.floor(n / 100)
      const m = n % 100
      if (h <= 23 && m <= 59) return { value: minutesToHhMm(h * 60 + m), rawText, reason: null }
    }
    return {
      value: null,
      rawText,
      reason: `"${rawText}" could not be read as a time of day, so no time was set`,
    }
  }

  const text = String(raw).trim()

  const digits = HHMM_DIGITS.exec(text)
  if (digits) {
    const n = Number(digits[1])
    const h = Math.floor(n / 100)
    const m = n % 100
    if (h <= 23 && m <= 59) return { value: minutesToHhMm(h * 60 + m), rawText, reason: null }
  }

  const clock = CLOCK_TEXT.exec(text)
  if (clock) {
    const hour = applyMeridiem(Number(clock[1]), clock[3])
    const minute = clock[2] === undefined ? 0 : Number(clock[2])
    if (hour !== null && minute >= 0 && minute <= 59) {
      return { value: minutesToHhMm(hour * 60 + minute), rawText, reason: null }
    }
  }

  return {
    value: null,
    rawText,
    reason: `"${rawText}" could not be read as a time of day, so no time was set`,
  }
}

// ---------------------------------------------------------------------------
// travel mode
// ---------------------------------------------------------------------------

export interface ModeCellResult {
  value: TravelMode | null
  rawText: string | null
  reason: string | null
}

/**
 * The four phrasings this sheet actually uses:
 *
 *   "By Road" / "Local Pick up" -> self_drive
 *   "Flight"                    -> air
 *   "Train"                     -> train
 *   "Bus"                       -> bus
 *
 * `app.travel_mode` also has 'cab', which NOTHING in this sheet maps to. No
 * mapping is invented for it: a family that came by hired car is indexed here
 * under whatever the sheet says, and a caller can correct it. Guessing 'cab'
 * would put a fabricated fact in front of the logistics team.
 *
 * Word-boundary matched, so "repair" is not "air" and "Ahmedabad" is not "bus".
 */
export function parseTravelMode(raw: unknown): ModeCellResult {
  if (isBlankCell(raw)) return { value: null, rawText: null, reason: null }

  const rawText = rawCellText(raw) ?? ''
  const text = rawText.toLowerCase().replace(/[_\-./]/g, ' ').replace(/\s+/g, ' ').trim()

  const has = (pattern: RegExp) => pattern.test(text)

  if (has(/\b(flight|air|aeroplane|airplane|plane|indigo|vistara)\b/)) {
    return { value: 'air', rawText, reason: null }
  }
  if (has(/\b(train|rail|railway)\b/)) return { value: 'train', rawText, reason: null }
  if (has(/\b(bus|coach|volvo)\b/)) return { value: 'bus', rawText, reason: null }
  if (has(/\b(road|local|self|own|drive|driving|car)\b/)) {
    return { value: 'self_drive', rawText, reason: null }
  }

  return {
    value: null,
    rawText,
    reason: `"${rawText}" is not one of Flight / Train / Bus / By Road, so no travel mode was set`,
  }
}

// ---------------------------------------------------------------------------
// SR.NO
// ---------------------------------------------------------------------------

/** The serial number as an integer, or null when the cell will not read as one. */
export function parseSerialNumber(raw: unknown): number | null {
  if (isBlankCell(raw)) return null
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && Number.isInteger(raw) && raw >= 0 ? raw : null
  }
  const m = /^(\d{1,6})$/.exec(String(raw).trim())
  return m ? Number(m[1]) : null
}
