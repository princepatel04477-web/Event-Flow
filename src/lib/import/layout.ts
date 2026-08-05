/**
 * Known-layout column resolution for CALLING_MASTER_LIST.xlsx (Sheet1).
 *
 * The header row of that workbook is:
 *
 *   U | SR.NO | <blank> | PLACE | CONTACT | ID | Romm | bed | Pax
 *     | Arrival Date | Time | Mode | Details | Pick up | Remark
 *     | Departure Date | Time | Mode | Details | Drop
 *
 * Two properties of that row make a plain header->field lookup impossible,
 * and both are handled here rather than anywhere downstream:
 *
 *  1. "Time", "Mode" and "Details" EACH APPEAR TWICE — once for arrival, once
 *     for departure. They are resolved BY POSITION relative to the two date
 *     columns, never by name. The pairing is derived from where "Arrival Date"
 *     and "Departure Date" actually sit in this sheet, so inserting a column
 *     anywhere does not silently swap a departure time onto an arrival leg.
 *
 *  2. The name column's header cell is usually BLANK. It is located by
 *     position: the single column between SR.NO and PLACE.
 *
 * Resolution is EXACT-MATCH ONLY against a short alias list, case-insensitive
 * and whitespace/punctuation-normalised. There is deliberately no fuzzy
 * substring matching in this module: a wrong column here means every family
 * gets someone else's phone number, and the operator would have no way to
 * see it. When this resolver fails it says exactly which headers are missing
 * and the wizard falls back to `autoDetectMapping` + the manual mapping step
 * in mapper.ts, which is what a second event's differently-shaped workbook
 * will need anyway.
 *
 * Pure: no DOM, no SheetJS, no Supabase.
 */

/** Every column this layout knows about. */
export type KnownColumnKey =
  | 'u'
  | 'srNo'
  | 'name'
  | 'place'
  | 'contact'
  | 'id'
  | 'room'
  | 'bed'
  | 'pax'
  | 'arrivalDate'
  | 'arrivalTime'
  | 'arrivalMode'
  | 'arrivalDetails'
  | 'pickUp'
  | 'remark'
  | 'departureDate'
  | 'departureTime'
  | 'departureMode'
  | 'departureDetails'
  | 'drop'

/**
 * Columns captured for Phase 2 (room allocation) but not required for the
 * Phase 1 calling list. Their absence is a note, not a failure.
 */
export const OPTIONAL_COLUMNS = ['id', 'room', 'bed'] as const
export type OptionalColumnKey = (typeof OPTIONAL_COLUMNS)[number]
export type RequiredColumnKey = Exclude<KnownColumnKey, OptionalColumnKey>

/** Resolved 0-based column indices into the header row. */
export type KnownLayout = Record<RequiredColumnKey, number> &
  Record<OptionalColumnKey, number | null>

/** Header text as it appears in the sheet, for messages the operator reads. */
export const COLUMN_LABELS: Record<KnownColumnKey, string> = {
  u: 'U (family number)',
  srNo: 'SR.NO',
  name: 'Name (the blank-headed column between SR.NO and PLACE)',
  place: 'PLACE',
  contact: 'CONTACT',
  id: 'ID',
  room: 'Romm',
  bed: 'bed',
  pax: 'Pax',
  arrivalDate: 'Arrival Date',
  arrivalTime: 'Time (arrival — the first one, after Arrival Date)',
  arrivalMode: 'Mode (arrival — the first one, after Arrival Date)',
  arrivalDetails: 'Details (arrival — the first one, after Arrival Date)',
  pickUp: 'Pick up',
  remark: 'Remark',
  departureDate: 'Departure Date',
  departureTime: 'Time (departure — the second one, after Departure Date)',
  departureMode: 'Mode (departure — the second one, after Departure Date)',
  departureDetails: 'Details (departure — the second one, after Departure Date)',
  drop: 'Drop',
}

/**
 * Accepted header spellings, already normalised (lower case, punctuation to
 * spaces, whitespace collapsed). Matching is EXACT against this list.
 * "Romm" is the real spelling in the file; "room" is accepted too because a
 * later hand-corrected copy of the sheet will fix the typo.
 */
const ALIASES: Record<Exclude<KnownColumnKey, 'name'>, string[]> = {
  u: ['u', 'u no', 'family', 'family no', 'family number'],
  srNo: ['sr no', 'sr', 's no', 'sno', 'serial', 'serial no'],
  place: ['place', 'city', 'native place'],
  contact: ['contact', 'contact no', 'contact number', 'mobile', 'mobile no', 'phone', 'phone no'],
  id: ['id', 'id no', 'id proof'],
  room: ['romm', 'room', 'romm no', 'room no'],
  bed: ['bed', 'beds', 'bed no'],
  pax: ['pax', 'no of pax', 'total pax'],
  arrivalDate: ['arrival date', 'arrival dt', 'date of arrival', 'arrival'],
  arrivalTime: ['time'],
  arrivalMode: ['mode'],
  arrivalDetails: ['details', 'detail'],
  pickUp: ['pick up', 'pickup', 'pick up point', 'pickup point'],
  // NOT "note"/"notes": a sheet that carries both a "Remark" and a "Notes"
  // column would then match twice and the whole layout would be rejected as
  // ambiguous. Aliases here are for spelling variants of the SAME column, not
  // for plausible neighbours.
  remark: ['remark', 'remarks'],
  departureDate: ['departure date', 'departure dt', 'date of departure', 'departure', 'dep date'],
  departureTime: ['time'],
  departureMode: ['mode'],
  departureDetails: ['details', 'detail'],
  drop: ['drop', 'drop point', 'drop off'],
}

/** Aliases accepted for the name column when its header is NOT blank. */
const NAME_ALIASES = ['name', 'names', 'guest name', 'full name', 'guest']

/** Columns that must appear exactly once, resolved by name alone. */
const SINGLETON_KEYS = [
  'u',
  'srNo',
  'place',
  'contact',
  'id',
  'room',
  'bed',
  'pax',
  'arrivalDate',
  'pickUp',
  'remark',
  'departureDate',
  'drop',
] as const

/** Columns whose header text is duplicated and must be resolved by position. */
const PAIRED_KEYS = [
  { arrival: 'arrivalTime', departure: 'departureTime', alias: 'time' },
  { arrival: 'arrivalMode', departure: 'departureMode', alias: 'mode' },
  { arrival: 'arrivalDetails', departure: 'departureDetails', alias: 'details' },
] as const

export interface MissingColumn {
  column: KnownColumnKey
  label: string
  /** Why it could not be resolved, in words the operator can act on. */
  detail: string
}

export interface LayoutNote {
  column: KnownColumnKey
  label: string
  detail: string
}

export interface KnownLayoutSuccess {
  ok: true
  layout: KnownLayout
  /** Optional columns that were absent, and anything else worth surfacing. */
  notes: LayoutNote[]
}

export interface KnownLayoutFailure {
  ok: false
  /** Exactly which required headers could not be resolved. Never a guess. */
  missing: MissingColumn[]
  /** One-line summary for the top of the screen. */
  reason: string
}

export type KnownLayoutResult = KnownLayoutSuccess | KnownLayoutFailure

/** lower case, `._-` to spaces, whitespace collapsed, trimmed. */
export function normaliseHeaderText(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
    .toLowerCase()
    .replace(/[_\-.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function occurrences(headers: string[], aliases: string[]): number[] {
  const found: number[] = []
  headers.forEach((h, i) => {
    if (h && aliases.includes(h)) found.push(i)
  })
  return found
}

/**
 * Resolve the known layout against one candidate header row.
 *
 * Returns either every column index, or a structured list of exactly which
 * required headers are missing. Never partially guesses.
 */
export function resolveKnownLayout(headers: (string | null)[]): KnownLayoutResult {
  const norm = headers.map(normaliseHeaderText)
  const missing: MissingColumn[] = []
  const notes: LayoutNote[] = []
  const found: Partial<Record<KnownColumnKey, number>> = {}

  for (const key of SINGLETON_KEYS) {
    const hits = occurrences(norm, ALIASES[key])
    const optional = (OPTIONAL_COLUMNS as readonly string[]).includes(key)

    if (hits.length === 1) {
      found[key] = hits[0]
      continue
    }

    if (hits.length === 0) {
      if (optional) {
        notes.push({
          column: key,
          label: COLUMN_LABELS[key],
          detail: 'not in this sheet — nothing to carry forward for room allocation later.',
        })
      } else {
        missing.push({
          column: key,
          label: COLUMN_LABELS[key],
          detail: 'no column with this header.',
        })
      }
      continue
    }

    // Duplicated where it must be unique. Refusing here is the point: picking
    // one at random is how a whole column of data lands on the wrong field.
    const detail = `appears ${hits.length} times (columns ${hits
      .map((i) => i + 1)
      .join(', ')}) — it must appear once.`
    if (optional) {
      notes.push({ column: key, label: COLUMN_LABELS[key], detail: `${detail} Ignored.` })
    } else {
      missing.push({ column: key, label: COLUMN_LABELS[key], detail })
    }
  }

  const arrivalDate = found.arrivalDate
  const departureDate = found.departureDate

  // ---- the three duplicated headers, resolved by position -----------------
  //
  // Anchored on the two date columns so the arrival/departure split comes
  // from this sheet's actual shape rather than a hardcoded index.
  if (typeof arrivalDate === 'number' && typeof departureDate === 'number') {
    if (departureDate <= arrivalDate) {
      missing.push({
        column: 'departureDate',
        label: COLUMN_LABELS.departureDate,
        detail: `sits at column ${departureDate + 1}, at or before "Arrival Date" at column ${
          arrivalDate + 1
        } — arrival must come first for Time/Mode/Details to be split reliably.`,
      })
    } else {
      for (const pair of PAIRED_KEYS) {
        const hits = occurrences(norm, [pair.alias])
        const arrivalHit = hits.find((i) => i > arrivalDate && i < departureDate)
        const departureHit = hits.find((i) => i > departureDate)

        if (arrivalHit === undefined) {
          missing.push({
            column: pair.arrival,
            label: COLUMN_LABELS[pair.arrival],
            detail: `no "${pair.alias}" column between "Arrival Date" and "Departure Date".`,
          })
        } else {
          found[pair.arrival] = arrivalHit
        }

        if (departureHit === undefined) {
          missing.push({
            column: pair.departure,
            label: COLUMN_LABELS[pair.departure],
            detail: `no "${pair.alias}" column after "Departure Date".`,
          })
        } else {
          found[pair.departure] = departureHit
        }
      }
    }
  } else {
    // Without both anchors the pairing cannot be derived at all. Report the
    // six dependent columns rather than letting them look independently absent.
    for (const pair of PAIRED_KEYS) {
      for (const key of [pair.arrival, pair.departure] as const) {
        missing.push({
          column: key,
          label: COLUMN_LABELS[key],
          detail:
            'cannot be resolved: "Time", "Mode" and "Details" each appear twice, and the ' +
            'Arrival Date / Departure Date columns are what tells the two apart.',
        })
      }
    }
  }

  // ---- the blank-headed name column --------------------------------------
  const srNo = found.srNo
  const place = found.place
  if (typeof srNo === 'number' && typeof place === 'number' && place > srNo + 1) {
    const between: number[] = []
    for (let i = srNo + 1; i < place; i++) between.push(i)

    const blanks = between.filter((i) => norm[i] === '')
    const named = between.filter((i) => NAME_ALIASES.includes(norm[i]))

    if (blanks.length === 1) {
      found.name = blanks[0]
    } else if (named.length === 1) {
      found.name = named[0]
    } else if (between.length === 1) {
      found.name = between[0]
    } else {
      missing.push({
        column: 'name',
        label: COLUMN_LABELS.name,
        detail:
          blanks.length > 1
            ? `${blanks.length} blank-headed columns sit between SR.NO and PLACE — cannot tell which one holds the name.`
            : 'no single column sits between SR.NO and PLACE.',
      })
    }
  } else {
    missing.push({
      column: 'name',
      label: COLUMN_LABELS.name,
      detail:
        typeof srNo === 'number' && typeof place === 'number'
          ? 'PLACE sits immediately after SR.NO, leaving no column for the name.'
          : 'needs SR.NO and PLACE resolved first — the name column is located between them.',
    })
  }

  if (missing.length > 0) {
    return {
      ok: false,
      missing,
      reason:
        `This sheet does not match the CALLING_MASTER_LIST layout: ` +
        `${missing.length} required column${missing.length === 1 ? '' : 's'} could not be found. ` +
        `Map the columns by hand instead.`,
    }
  }

  const layout: KnownLayout = {
    u: found.u as number,
    srNo: found.srNo as number,
    name: found.name as number,
    place: found.place as number,
    contact: found.contact as number,
    pax: found.pax as number,
    arrivalDate: found.arrivalDate as number,
    arrivalTime: found.arrivalTime as number,
    arrivalMode: found.arrivalMode as number,
    arrivalDetails: found.arrivalDetails as number,
    pickUp: found.pickUp as number,
    remark: found.remark as number,
    departureDate: found.departureDate as number,
    departureTime: found.departureTime as number,
    departureMode: found.departureMode as number,
    departureDetails: found.departureDetails as number,
    drop: found.drop as number,
    id: found.id ?? null,
    room: found.room ?? null,
    bed: found.bed ?? null,
  }

  return { ok: true, layout, notes }
}

export interface LocatedLayout extends KnownLayoutSuccess {
  /** 0-based index into the grid of the row that resolved as the header. */
  headerRowIndex: number
  headers: (string | null)[]
}

export type LocateLayoutResult = LocatedLayout | KnownLayoutFailure

/**
 * Find the header row in a raw grid and resolve the layout against it.
 *
 * Scans the first `maxScanRows` rows rather than assuming row 1, because a
 * hand-maintained sheet often carries a title or a blank row above the
 * headers. A candidate row is only accepted when the FULL layout resolves
 * against it, so this never mistakes a data row for the header.
 *
 * On failure it reports the missing columns from the best candidate — the row
 * that got closest — so the operator sees the real problem rather than
 * "row 1 is blank".
 */
export function locateKnownLayout(grid: unknown[][], maxScanRows = 10): LocateLayoutResult {
  let best: KnownLayoutFailure | null = null
  let bestMissing = Number.POSITIVE_INFINITY

  const limit = Math.min(grid.length, maxScanRows)
  for (let i = 0; i < limit; i++) {
    const headers = (grid[i] ?? []).map((cell) => {
      if (cell === null || cell === undefined) return null
      const text = String(cell).trim()
      return text === '' ? null : text
    })

    const result = resolveKnownLayout(headers)
    if (result.ok) {
      return { ...result, headerRowIndex: i, headers }
    }

    if (result.missing.length < bestMissing) {
      bestMissing = result.missing.length
      best = result
    }
  }

  return (
    best ?? {
      ok: false,
      missing: [],
      reason: 'That sheet has no rows to read a header from.',
    }
  )
}

/** True when this header row is the CALLING_MASTER_LIST layout. */
export function matchesKnownLayout(headers: (string | null)[]): boolean {
  return resolveKnownLayout(headers).ok
}
