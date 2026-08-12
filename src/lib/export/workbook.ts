/**
 * Excel export — the trusted output format (client, hotel, transport vendor).
 *
 * CORE RULE — ROUND-TRIP SAFETY. The Guest Master sheet reproduces the
 * EXACT header row the import parser knows (`src/lib/import/layout.ts`) and
 * writes back the same identity cells (U / name / CONTACT) that
 * `source_row_hash` is derived from, plus the group UUID in an `_id` column.
 * Re-importing an untouched export therefore matches every row by hash and
 * UPDATES in place — zero duplicates, zero changes (the round-trip test
 * asserts exactly this).
 *
 * FORMAT TRAPS (each handled explicitly):
 *   a) Phone numbers: cell type 's' (string) so "+919876543210" and
 *      leading-zero numbers survive — Excel would otherwise coerce to
 *      scientific notation and strip the 0.
 *   b) Dates: real Excel date cells (type 'd') with number format
 *      'dd/mm/yyyy'. ISO strings get re-locale'd by Excel and break the
 *      round-trip.
 *   c) Times: 'hh:mm' formatted cells. All times are IST by the source data;
 *      "All times IST" is printed in the header row.
 *   d) NULLs: written as empty cells. Never the string "null", "N/A" or 0.
 *   e) Long text: wrapped cells with sensible column widths.
 *   f) Headers: row 1 frozen, autofilter applied.
 *   g) Colour: amber fill on exception rows only — colour means action.
 *
 * Dependency-light: takes a SheetJS `Workbook` type, so it can run in the
 * browser (client export) and in tests (Node) alike. Pure: no Supabase, no
 * server-only imports.
 */
import * as XLSX from 'xlsx'

// ---------------------------------------------------------------------------
// Column definition
// ---------------------------------------------------------------------------

export type CellValue = string | number | boolean | Date | null | undefined

export interface SheetColumn<TRow> {
  /** Stable key. Also the `_id`-style key for identity columns. */
  key: keyof TRow & string
  /** The header label exactly as it must read in the sheet. */
  header: string
  /**
   * 'string'  — forced to Excel string cell. Phone numbers MUST use this.
   * 'date'    — real date cell, number format dd/mm/yyyy.
   * 'time'    — hh:mm formatted cell.
   * 'number'  — numeric cell.
   * 'boolean' — TRUE/FALSE.
   * 'text'    — wrapped text (long notes).
   * (default) — plain string/number passthrough, empty for null.
   */
  type?: 'string' | 'date' | 'time' | 'number' | 'boolean' | 'text'
  /** Column width in Excel characters. */
  width?: number
  /** Function to extract the value from a row. Defaults to row[key]. */
  value?: (row: TRow) => CellValue
}

export interface SheetDefinition<TRow> {
  /** The sheet tab name. */
  name: string
  columns: SheetColumn<TRow>[]
  /** Rows to write. */
  rows: TRow[]
  /**
   * Which row to colour amber (an exception). Returning false leaves the row
   * uncoloured. Only exception rows get colour — see header note g).
   */
  isException?: (row: TRow) => boolean
  /** Extra text appended to the header row (e.g. "All times IST"). */
  headerNote?: string
}

/**
 * A sheet definition for the heterogeneous workbook — each sheet's columns
 * carry their own value extractors, so the row types need not be uniform.
 *
 * Columns and rows are widened to `readonly unknown[]` here — the concrete
 * shapes live on `SheetDefinition<X>`, and `buildSheet` narrows each item
 * structurally (a checked cast, never `any`).
 */
export interface AnySheetDefinition {
  name: string
  columns: readonly unknown[]
  rows: readonly unknown[]
  isException?: (row: unknown) => boolean
  headerNote?: string
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const AMBER_FILL = { fgColor: { rgb: 'FFF3CD' } }

const HEADER_STYLE = {
  font: { bold: true },
  fill: { fgColor: { rgb: 'F1F5F9' } },
  alignment: { vertical: 'center' as const },
}

function dateToExcelDate(value: Date): number {
  // SheetJS serial date: days since 1899-12-30.
  const epoch = Date.UTC(1899, 11, 30)
  return (value.getTime() - epoch) / 86400000
}

/** Convert a "HH:MM" or "HH:MM:SS" string into a fraction of a day for the
 *  Excel time cell, or null when it is not a valid time. */
export function timeToExcel(value: string | null | undefined): number | null {
  if (!value) return null
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim())
  if (!match) return null
  const h = Number(match[1])
  const m = Number(match[2])
  const s = match[3] ? Number(match[3]) : 0
  if (h > 23 || m > 59 || s > 59) return null
  return (h * 3600 + m * 60 + s) / 86400
}

/** A phone number that must survive Excel's number coercion as text. */
export function phoneCell(value: string | null | undefined): CellValue {
  const v = value?.trim()
  return v ? v : null
}

// ---------------------------------------------------------------------------
// buildWorkbook — one declarative entry point
// ---------------------------------------------------------------------------

export interface BuildWorkbookOptions {
  /** Frozen header row + autofilter on every sheet. */
  freezeAndFilter?: boolean
}

/**
 * Build a workbook from declarative sheet definitions. One function for every
 * sheet; adding a sheet is data, not code.
 *
 * Accepts heterogeneous sheets (each with its own row type); columns carry
 * their own value extractors so nothing is lost. The parameter is widened to
 * `readonly unknown[]` so any mix of `SheetDefinition<X>` can be passed; each
 * sheet is narrowed structurally inside.
 *
 * Every cell is written explicitly with its type and format, so the traps in
 * the module header cannot sneak back in via an unformatted passthrough.
 */
export function buildWorkbook(
  sheets: readonly AnySheetDefinition[],
  options: BuildWorkbookOptions = {},
): XLSX.WorkBook {
  const freezeAndFilter = options.freezeAndFilter ?? true
  const wb = XLSX.utils.book_new()

  for (const sheet of sheets) {
    const ws = buildSheet(sheet, freezeAndFilter)
    XLSX.utils.book_append_sheet(wb, ws, sheet.name)
  }

  return wb
}

function buildSheet(
  def: AnySheetDefinition,
  freezeAndFilter: boolean,
): XLSX.WorkSheet {
  const { columns, rows, headerNote, isException } = def

  // Structural narrowing of the heterogeneous column defs — a checked cast,
  // not `any`: every column is expected to carry header/type/width, and the
  // value extractor is invoked with the row it belongs to.
  const cols = columns as {
    key: string
    header: string
    type?: 'string' | 'date' | 'time' | 'number' | 'boolean' | 'text'
    width?: number
    value?: (row: unknown) => CellValue
  }[]

  const aoa: (string | number | boolean | Date)[][] = []

  // Header row. If the sheet has a header note, append it to the LAST header
  // cell with a separator so it reads "LastColumn · headerNote" rather than
  // occupying a stray extra column that confuses the round-trip importer.
  const headerCells = cols.map((c) => c.header)
  if (headerNote && headerCells.length > 0) {
    headerCells[headerCells.length - 1] = `${headerCells[headerCells.length - 1]} · ${headerNote}`
  }
  aoa.push(headerCells)

  for (const row of rows) {
    const cells: (string | number | boolean | Date)[] = []
    for (const col of cols) {
      const raw = col.value ? col.value(row) : ((row as Record<string, unknown>)[col.key] as CellValue)
      cells.push(cellForColumn(raw, col))
    }
    aoa.push(cells)
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const sheetRange = XLSX.utils.decode_range(ws['!ref'] ?? 'A1:A1')

  // ---- column widths + per-cell formats --------------------------------
  ws['!cols'] = cols.map((c) => ({ wch: c.width ?? guessWidth(c.header) }))

  for (let c = 0; c < cols.length; c++) {
    const col = cols[c]
    const cellAddress = XLSX.utils.encode_cell({ r: 0, c })
    const headerCell = ws[cellAddress]
    if (headerCell) headerCell.s = HEADER_STYLE

    for (let r = 1; r <= sheetRange.e.r; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })]
      if (!cell) continue
      applyCellFormat(cell, col)
    }
  }

  // ---- amber exception rows --------------------------------------------
  if (isException) {
    for (let r = 1; r <= sheetRange.e.r; r++) {
      const rowData = rows[r - 1]
      if (rowData && isException(rowData)) {
        for (let c = 0; c < cols.length; c++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })]
          if (cell) cell.s = { ...(cell.s ?? {}), fill: AMBER_FILL }
        }
      }
    }
  }

  // ---- freeze + autofilter ---------------------------------------------
  if (freezeAndFilter) {
    ws['!autofilter'] = { ref: XLSX.utils.encode_range(sheetRange) }
    ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2' }
  }

  return ws
}

/** Convert one source value into a SheetJS cell value with the right coercion. */
function cellForColumn(
  raw: CellValue,
  col: { type?: 'string' | 'date' | 'time' | 'number' | 'boolean' | 'text' },
): string | number | boolean | Date {
  // NULLS: empty cell — never "null", "N/A" or 0.
  if (raw === null || raw === undefined) return ''
  if (typeof raw === 'boolean') return raw

  switch (col.type) {
    case 'string':
      return typeof raw === 'string' ? raw : String(raw)
    case 'number':
      return typeof raw === 'number' ? raw : String(raw)
    case 'date':
      return raw instanceof Date ? dateToExcelDate(raw) : String(raw)
    case 'time': {
      if (typeof raw === 'string') {
        const t = timeToExcel(raw)
        return t === null ? raw : t
      }
      return String(raw)
    }
    case 'boolean':
      return Boolean(raw)
    case 'text':
      return String(raw)
    default:
      return typeof raw === 'string' ? raw : typeof raw === 'number' ? raw : String(raw)
  }
}

/** Apply the number format / alignment a column type dictates. */
function applyCellFormat(
  cell: XLSX.CellObject,
  col: { type?: 'string' | 'date' | 'time' | 'number' | 'boolean' | 'text' },
): void {
  // SheetJS keeps number format on the cell's `z` (a top-level property),
  // not inside the style object — setting `s.numFmt` there is a no-op for
  // readers. Alignment/wrap live in `s`.
  switch (col.type) {
    case 'date':
      cell.z = 'dd/mm/yyyy'
      break
    case 'time':
      cell.z = 'hh:mm'
      break
    case 'text':
      cell.s = { ...(cell.s ?? {}), alignment: { ...(cell.s?.alignment ?? {}), wrapText: true } }
      break
  }
}

function guessWidth(header: string): number {
  // Rough: chars + headroom, clamped to something sane for a phone screen.
  return Math.min(40, Math.max(10, Math.ceil(header.length * 1.2) + 2))
}

export default buildWorkbook
