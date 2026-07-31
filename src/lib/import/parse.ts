/**
 * Workbook parsing for Excel import.
 *
 * Runs entirely in the browser (SheetJS ships pure JS with no DOM
 * dependency, but nothing here uploads the file - it stays local until the
 * user has confirmed a preview). Deliberately dumb: this module only turns
 * a File into rows of raw cells. Column meaning, validation and hashing
 * live in mapper.ts / normalize.ts / hash.ts.
 */

import * as XLSX from 'xlsx'

import { autoDetectMapping, type ColumnMapping } from './mapper'

export interface RawSheetRow {
  /** 1-based row number as it appears in the original sheet (header = row 1). */
  sheetRowNumber: number
  cells: unknown[]
}

export interface ParsedSheet {
  sheetName: string
  headers: (string | null)[]
  rows: RawSheetRow[]
  suggestedMapping: ColumnMapping
}

/** Columns forward-filled across a visually merged family block. */
const GROUP_FILL_FIELDS = [
  'group_code',
  'head_name',
  'primary_mobile',
  'alt_mobile',
  'side',
  'group_type',
  'city',
  'needs_return_gift',
] as const

function isBlankCell(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === ''
}

/** Reads the first sheet of a workbook into raw rows, skipping blank ones. */
export async function parseWorkbook(file: File): Promise<ParsedSheet> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false })

  const sheetName = workbook.SheetNames[0]
  if (!sheetName) {
    throw new Error('That workbook has no sheets.')
  }

  const worksheet = workbook.Sheets[sheetName]
  const grid = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  })

  if (grid.length === 0) {
    throw new Error(`"${sheetName}" is empty.`)
  }

  const [headerRow, ...dataRows] = grid
  const headers = headerRow.map((h) => (isBlankCell(h) ? null : String(h)))

  const rows: RawSheetRow[] = dataRows
    .map((cells, i) => ({ sheetRowNumber: i + 2, cells }))
    .filter((row) => row.cells.some((c) => !isBlankCell(c)))

  return {
    sheetName,
    headers,
    rows,
    suggestedMapping: autoDetectMapping(headers),
  }
}

/**
 * Forward-fills blank cells in the family-identifying columns from the
 * nearest preceding non-blank row, so a visually merged family block (one
 * header row per family, blank cells on the member rows beneath it) resolves
 * to identical identity fields on every row. Those rows then collapse onto
 * one `guest_groups` upsert via the row hash instead of becoming duplicates.
 */
export function forwardFillGroupColumns(
  rows: RawSheetRow[],
  mapping: ColumnMapping,
): RawSheetRow[] {
  const fillColumns = GROUP_FILL_FIELDS.map((key) => mapping[key]).filter(
    (idx): idx is number => typeof idx === 'number',
  )

  if (fillColumns.length === 0) return rows

  const last = new Map<number, unknown>()

  return rows.map((row) => {
    const cells = [...row.cells]

    for (const col of fillColumns) {
      const value = cells[col]
      if (isBlankCell(value)) {
        if (last.has(col)) cells[col] = last.get(col)
      } else {
        last.set(col, value)
      }
    }

    return { ...row, cells }
  })
}
