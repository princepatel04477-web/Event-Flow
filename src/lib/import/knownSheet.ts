/**
 * One entry point for the known CALLING_MASTER_LIST path.
 *
 * Read Sheet1 -> locate and resolve the known header row -> group into
 * families with members -> return a preview payload. Nothing here writes: the
 * whole module chain is read-only by construction (no Supabase import exists
 * anywhere under src/lib/import).
 *
 * The failure mode is the interesting one. When the layout does not resolve
 * this returns a STRUCTURED failure naming exactly which headers are missing,
 * and the caller falls back to `autoDetectMapping` + the manual mapping step.
 * That fallback is not dead weight: a second event brings a different
 * workbook, and the manual mapper is the only thing that can read it.
 */

import { parseFamilies, type ParsedFamilySheet, type ParseFamiliesOptions } from './families'
import {
  locateKnownLayout,
  type KnownLayout,
  type KnownLayoutFailure,
  type LayoutNote,
} from './layout'
import { KNOWN_SHEET_NAME, readSheetGrid, toSheetRows, SheetNotFoundError } from './parse'

export interface KnownSheetSuccess {
  ok: true
  sheetName: string
  availableSheets: string[]
  /** 1-based row number the headers were found on. Usually 1. */
  headerRowNumber: number
  headers: (string | null)[]
  layout: KnownLayout
  /** Optional columns (ID / Romm / bed) that were absent, and similar. */
  notes: LayoutNote[]
  result: ParsedFamilySheet
}

export interface KnownSheetFailure extends KnownLayoutFailure {
  sheetName: string
  availableSheets: string[]
  headers: (string | null)[]
}

export type KnownSheetOutcome = KnownSheetSuccess | KnownSheetFailure

/**
 * Parses a workbook against the known layout.
 *
 * Throws only when the named sheet is absent (`SheetNotFoundError`) — that is
 * a different problem from a mismatched layout and deserves a different
 * message, because the fix is "rename the tab", not "map the columns".
 */
export async function parseKnownWorkbook(
  file: File,
  options: ParseFamiliesOptions,
  sheetName: string = KNOWN_SHEET_NAME,
): Promise<KnownSheetOutcome> {
  const { sheetName: resolvedName, availableSheets, grid } = await readSheetGrid(file, sheetName)

  const located = locateKnownLayout(grid)

  if (!located.ok) {
    return {
      ...located,
      sheetName: resolvedName,
      availableSheets,
      headers: (grid[0] ?? []).map((c) =>
        c === null || c === undefined || String(c).trim() === '' ? null : String(c),
      ),
    }
  }

  const { headers, rows, blankRowsSkipped } = toSheetRows(grid, located.headerRowIndex)

  return {
    ok: true,
    sheetName: resolvedName,
    availableSheets,
    headerRowNumber: located.headerRowIndex + 1,
    headers,
    layout: located.layout,
    notes: located.notes,
    result: parseFamilies({ headers, rows, blankRowsSkipped }, located.layout, options),
  }
}

export { SheetNotFoundError, KNOWN_SHEET_NAME }
