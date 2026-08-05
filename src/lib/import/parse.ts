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

/**
 * `blankrows: true` is load-bearing, not a preference.
 *
 * With `blankrows: false` SheetJS removes blank rows from the array, and every
 * row after a gap then has an array index one lower than its real position in
 * the sheet. The row numbers in the preview — the numbers an operator uses to
 * find and fix a cell — would silently drift down by one per blank row. Blank
 * rows are instead kept here and filtered afterwards, so `sheetRowNumber`
 * always means the row number Excel shows in its own left-hand gutter.
 */
function readGrid(worksheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  })
}

/** Reads the first sheet of a workbook into raw rows, skipping blank ones. */
export async function parseWorkbook(file: File): Promise<ParsedSheet> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false })

  const sheetName = workbook.SheetNames[0]
  if (!sheetName) {
    throw new Error('That workbook has no sheets.')
  }

  const grid = readGrid(workbook.Sheets[sheetName])

  if (grid.length === 0) {
    throw new Error(`"${sheetName}" is empty.`)
  }

  const [headerRow, ...dataRows] = grid
  const headers = (headerRow ?? []).map((h) => (isBlankCell(h) ? null : String(h)))

  const rows: RawSheetRow[] = dataRows
    .map((cells, i) => ({ sheetRowNumber: i + 2, cells: cells ?? [] }))
    .filter((row) => row.cells.some((c) => !isBlankCell(c)))

  return {
    sheetName,
    headers,
    rows,
    suggestedMapping: autoDetectMapping(headers),
  }
}

// ---------------------------------------------------------------------------
// Known-layout path — CALLING_MASTER_LIST.xlsx
// ---------------------------------------------------------------------------

/**
 * Sheet1, NOT Sheet7.
 *
 * Both sheets carry the family list, but only Sheet1 carries the `Romm` and
 * `bed` columns that Phase 2 backfills room allocation from. Importing from
 * Sheet7 loses them, and the sheet is not re-uploaded — it is hand-maintained
 * and will have moved on by then.
 */
export const KNOWN_SHEET_NAME = 'Sheet1'

export class SheetNotFoundError extends Error {
  readonly availableSheets: string[]
  readonly wanted: string

  constructor(wanted: string, availableSheets: string[]) {
    super(
      availableSheets.length === 0
        ? 'That workbook has no sheets.'
        : `That workbook has no sheet named "${wanted}". It has: ${availableSheets
            .map((s) => `"${s}"`)
            .join(', ')}. Rename the tab, or map the columns by hand.`,
    )
    this.name = 'SheetNotFoundError'
    this.wanted = wanted
    this.availableSheets = availableSheets
  }
}

export interface SheetGrid {
  sheetName: string
  availableSheets: string[]
  /** Every row of the used range, blank rows included, in sheet order. */
  grid: unknown[][]
}

/**
 * Reads ONE named sheet into a raw grid. Never falls back to "the first
 * sheet" — a workbook whose tab has been renamed is a workbook whose shape we
 * cannot vouch for, and silently importing the wrong tab is worse than
 * stopping and saying which tabs exist.
 */
export async function readSheetGrid(
  file: File,
  sheetName: string = KNOWN_SHEET_NAME,
): Promise<SheetGrid> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false })

  const availableSheets = [...workbook.SheetNames]
  const match = availableSheets.find((n) => n === sheetName)
    ?? availableSheets.find((n) => n.trim().toLowerCase() === sheetName.trim().toLowerCase())

  if (!match) throw new SheetNotFoundError(sheetName, availableSheets)

  return { sheetName: match, availableSheets, grid: readGrid(workbook.Sheets[match]) }
}

export interface SheetRows {
  headers: (string | null)[]
  /** Non-blank data rows below the header, with true sheet row numbers. */
  rows: RawSheetRow[]
  /** Blank rows below the header that were skipped — counted, not hidden. */
  blankRowsSkipped: number
}

/**
 * Splits a raw grid into a header row and the data rows below it, keeping
 * true 1-based sheet row numbers and counting what was skipped.
 */
export function toSheetRows(grid: unknown[][], headerRowIndex: number): SheetRows {
  const headerRow = grid[headerRowIndex] ?? []
  const headers = headerRow.map((h) => (isBlankCell(h) ? null : String(h)))

  const rows: RawSheetRow[] = []
  let blankRowsSkipped = 0

  for (let i = headerRowIndex + 1; i < grid.length; i++) {
    const cells = grid[i] ?? []
    if (!cells.some((c) => !isBlankCell(c))) {
      blankRowsSkipped++
      continue
    }
    rows.push({ sheetRowNumber: i + 1, cells })
  }

  return { headers, rows, blankRowsSkipped }
}

/**
 * Forward-fills blank cells in the family-identifying columns, so a visually
 * merged family block (one header row per family, blank cells on the member
 * rows beneath it) resolves to identical identity fields on every row. Those
 * rows then collapse onto one `guest_groups` upsert via the row hash instead
 * of becoming duplicates.
 *
 * THE RULE THAT MATTERS: a row inherits from the family above it ONLY when
 * its own head-name cell is blank — that is what makes it a continuation row
 * of the merged block. A row that names a different family head starts a new
 * block and inherits nothing, however many of its other cells are empty.
 *
 * Without that test, a family whose phone cell was left blank silently
 * acquired the previous family's number: the head name differs so the row
 * hashes differently and imports as its own `guest_groups` row, complete
 * with someone else's `primary_mobile`. A caller then taps the tel: link for
 * Suresh Shah and reaches Ramesh Patel, and the RSVP is logged against the
 * wrong family. The same mechanism set `needs_return_gift` on families that
 * merely sat below a special guest.
 */
export function forwardFillGroupColumns(
  rows: RawSheetRow[],
  mapping: ColumnMapping,
): RawSheetRow[] {
  const headColumn = mapping.head_name

  // With no head-name column there is no way to tell a continuation row from
  // a new family, and guessing is exactly the bug. Fill nothing.
  if (typeof headColumn !== 'number') return rows

  const fillColumns = GROUP_FILL_FIELDS.map((key) => mapping[key]).filter(
    (idx): idx is number => typeof idx === 'number',
  )

  if (fillColumns.length === 0) return rows

  // The identifying cells of the family block currently open, or null before
  // the first named head row in the sheet.
  let openBlock: Map<number, unknown> | null = null

  return rows.map((row) => {
    if (!isBlankCell(row.cells[headColumn])) {
      // Named head -> this row opens a new family block. It inherits nothing;
      // its own cells (blanks included) become what continuation rows below
      // it will inherit.
      openBlock = new Map(fillColumns.map((col) => [col, row.cells[col] ?? null]))
      return row
    }

    // Blank head -> continuation row of the block above, if there is one.
    if (!openBlock) return row

    const cells = [...row.cells]
    for (const col of fillColumns) {
      if (isBlankCell(cells[col])) cells[col] = openBlock.get(col) ?? null
    }

    return { ...row, cells }
  })
}
