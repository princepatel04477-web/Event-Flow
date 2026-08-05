/**
 * Builders for in-memory CALLING_MASTER_LIST sheets.
 *
 * The grouping and cell-cleaning tests need dozens of tiny sheets — two
 * families, one orphan, a blank contact — and writing a 20-element array by
 * hand for each of them is how a test ends up asserting against a row that is
 * not the row the author meant. Rows are therefore built from a NAMED spec and
 * the column order is declared once, here, in the same order as the real
 * header row.
 *
 * The layout is resolved through the real `resolveKnownLayout` rather than
 * hardcoded indices, so a test can never pass against a layout the production
 * resolver would reject.
 */

import { resolveKnownLayout, type KnownLayout } from '@/lib/import/layout'
import type { ParseFamiliesOptions } from '@/lib/import/families'
import type { RawSheetRow } from '@/lib/import/parse'

/**
 * The Sheet1 header row. "Time", "Mode" and "Details" appear twice; the name
 * column's header is blank. `scripts/build-test-fixture.mts` writes the same
 * row into the .xlsx, and `fixture.test.ts` asserts the two agree.
 */
export const HEADERS: (string | null)[] = [
  'U',
  'SR.NO',
  null,
  'PLACE',
  'CONTACT',
  'ID',
  'Romm',
  'bed',
  'Pax',
  'Arrival Date',
  'Time',
  'Mode',
  'Details',
  'Pick up',
  'Remark',
  'Departure Date',
  'Time',
  'Mode',
  'Details',
  'Drop',
]

export interface RowSpec {
  /** The "U" cell. Present only on a family's FIRST row. */
  u?: unknown
  sr?: unknown
  name?: unknown
  place?: unknown
  contact?: unknown
  id?: unknown
  room?: unknown
  bed?: unknown
  pax?: unknown
  arrDate?: unknown
  arrTime?: unknown
  arrMode?: unknown
  arrDetails?: unknown
  pickUp?: unknown
  remark?: unknown
  depDate?: unknown
  depTime?: unknown
  depMode?: unknown
  depDetails?: unknown
  drop?: unknown
}

const ORDER = [
  'u',
  'sr',
  'name',
  'place',
  'contact',
  'id',
  'room',
  'bed',
  'pax',
  'arrDate',
  'arrTime',
  'arrMode',
  'arrDetails',
  'pickUp',
  'remark',
  'depDate',
  'depTime',
  'depMode',
  'depDetails',
  'drop',
] as const satisfies readonly (keyof RowSpec)[]

/** One row of raw cells, in header order. Unset keys become null. */
export function cellsFor(spec: RowSpec): unknown[] {
  return ORDER.map((key) => spec[key] ?? null)
}

/**
 * Data rows with true 1-based sheet row numbers — the header occupies row 1,
 * so the first data row is row 2, exactly as Excel's gutter shows it.
 */
export function rowsFor(specs: RowSpec[], firstSheetRowNumber = 2): RawSheetRow[] {
  return specs.map((spec, i) => ({
    sheetRowNumber: firstSheetRowNumber + i,
    cells: cellsFor(spec),
  }))
}

/** The known layout, resolved by the production resolver. Throws if it fails. */
export function knownLayout(): KnownLayout {
  const resolved = resolveKnownLayout(HEADERS)
  if (!resolved.ok) {
    throw new Error(
      `the test header row no longer resolves: ${resolved.missing
        .map((m) => `${m.label} — ${m.detail}`)
        .join('; ')}`,
    )
  }
  return resolved.layout
}

/**
 * The event the fixture and the unit tests are parsed against: 3–8 December
 * 2026. Chosen so an ordinal resolved against TODAY instead of the event would
 * land in a different month and year, and the test would catch it.
 */
export const EVENT: ParseFamiliesOptions = {
  eventStartsOn: '2026-12-03',
  eventEndsOn: '2026-12-08',
}
