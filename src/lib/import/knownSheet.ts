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
import {
  parseContactsWorkbook,
  type ContactsParseSuccess,
} from './contactsSheet'

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
 * A workbook that parsed as either the known CALLING_MASTER_LIST layout or as
 * a simple contacts sheet. Both share the `ParsedFamilySheet` result shape,
 * so the preview and commit paths are identical for both.
 */
export type ImportOutcome =
  | KnownSheetSuccess
  | KnownSheetFailure
  | ContactsParseSuccess

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

/**
 * Parses a workbook against the known layout, then the contacts shape.
 *
 * Order matters: the known layout is the stricter, higher-value read (it
 * carries travel legs, pax and remarks), so a CALLING_MASTER_LIST file must
 * always be read as such. Only when it does not resolve does the contacts
 * fallback run — a two-column Name/Contact sheet is the common case for a
 * second event.
 *
 * Throws only when the named sheet is absent (`SheetNotFoundError`) — that is
 * a different problem from a mismatched layout and deserves a different
 * message, because the fix is "rename the tab", not "map the columns".
 */
export async function parseImportFile(
  file: File,
  options: ParseFamiliesOptions,
  sheetName: string = KNOWN_SHEET_NAME,
): Promise<ImportOutcome> {
  const known = await parseKnownWorkbook(file, options, sheetName)
  if (known.ok) return known

  const contacts = await parseContactsWorkbook(file, options, sheetName)
  if (contacts.ok) return contacts

  // Neither layout resolved. The contacts failure names what the contacts
  // shape needs; the known-layout failure carries the full missing-column
  // list. Report the known-layout one (it is the more actionable for a
  // master-shaped file), and keep the contacts reason as the fallback.
  return known
}

export { SheetNotFoundError, KNOWN_SHEET_NAME }
