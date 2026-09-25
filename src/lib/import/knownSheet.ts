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

import { isBlankCell } from './cells'
import { parseFamilies, type ParsedFamilySheet, type ParseFamiliesOptions } from './families'
import {
  locateKnownLayout,
  type KnownLayout,
  type KnownLayoutFailure,
  type LayoutNote,
} from './layout'
import {
  KNOWN_SHEET_NAME,
  readAllSheetGrids,
  readSheetGrid,
  toSheetRows,
  SheetNotFoundError,
} from './parse'
import {
  parseContactsSheet,
  resolveContactsGrid,
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
 * Parses a workbook as a guest list, whichever way it is shaped.
 *
 * The sheet is FOUND, not demanded. Every tab is tried against the known
 * CALLING_MASTER_LIST layout first — it is the richer read (travel legs, pax,
 * remarks) — and then against the simple contacts shape (a Name column and a
 * Contact column). Only when neither shape is found anywhere does this fail,
 * and then it names the column that was missing rather than the twenty that
 * were.
 *
 * This is what makes the app's own export re-importable. That export's guest
 * tab is named "Guest Master"; the previous version required a tab called
 * "Sheet1", so the file the app wrote could not be read back by the app.
 * `sheetName` is now a PREFERENCE (tried first when present), never a gate.
 *
 * Throws only for a file that cannot be opened as a workbook at all.
 */
export async function parseImportFile(
  file: File,
  options: ParseFamiliesOptions,
  sheetName: string = KNOWN_SHEET_NAME,
): Promise<ImportOutcome> {
  const { sheetNames, sheets } = await readAllSheetGrids(file)

  // The preferred tab first, then the rest in workbook order.
  const wanted = sheetName.trim().toLowerCase()
  const ordered = [
    ...sheets.filter((s) => s.sheetName.trim().toLowerCase() === wanted),
    ...sheets.filter((s) => s.sheetName.trim().toLowerCase() !== wanted),
  ]

  // Pass 1 — the known CALLING_MASTER_LIST layout, on every tab.
  let closest: KnownLayoutFailure | null = null
  let closestMissing = Number.POSITIVE_INFINITY
  let closestSheet = sheetNames[0] ?? sheetName
  let closestHeaders: (string | null)[] = []

  for (const { sheetName: name, grid } of ordered) {
    const located = locateKnownLayout(grid)
    if (located.ok) {
      const { headers, rows, blankRowsSkipped } = toSheetRows(grid, located.headerRowIndex)
      return {
        ok: true,
        sheetName: name,
        availableSheets: sheetNames,
        headerRowNumber: located.headerRowIndex + 1,
        headers,
        layout: located.layout,
        notes: located.notes,
        result: parseFamilies({ headers, rows, blankRowsSkipped }, located.layout, options),
      }
    }

    // Keep the candidate that got closest — its missing-column list is the
    // most actionable failure to show when nothing resolves.
    if (located.missing.length > 0 && located.missing.length < closestMissing) {
      closestMissing = located.missing.length
      closest = located
      closestSheet = name
      closestHeaders = (grid[0] ?? []).map((c) => (isBlankCell(c) ? null : String(c)))
    }
  }

  // Pass 2 — the simple contacts shape (a Name column and a Contact column).
  let contactsReason: string | null = null
  for (const { sheetName: name, grid } of ordered) {
    const contacts = resolveContactsGrid(grid, name)
    if (!contacts.ok) {
      if (contactsReason === null) contactsReason = contacts.reason
      continue
    }
    const parsed = parseContactsSheet(contacts.sheet, options)
    if (parsed.ok) return parsed
    if (contactsReason === null) contactsReason = parsed.reason
  }

  // Nothing resolved anywhere. A near-miss master (a column or two short)
  // reads best as the master's own missing-column list; anything else is
  // served better by the plain "it needs a Name and a Contact" line, which
  // names a column the operator can actually go and add.
  const plain = contactsReason ?? 'It needs a column of names and a column of phone numbers.'
  const nearMiss = closest !== null && closest.missing.length <= 3

  if (nearMiss && closest) {
    return {
      ok: false,
      missing: closest.missing,
      reason: `${closest.reason} ${plain}`,
      sheetName: closestSheet,
      availableSheets: sheetNames,
      headers: closestHeaders,
    }
  }

  return {
    ok: false,
    missing: [],
    reason: plain,
    sheetName: closestSheet,
    availableSheets: sheetNames,
    headers: closestHeaders,
  }
}

export { SheetNotFoundError, KNOWN_SHEET_NAME }
