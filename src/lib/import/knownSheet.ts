/**
 * One entry point for the known CALLING_MASTER_LIST path.
 *
 * Read the workbook -> find the tab carrying the known header row -> group
 * into families with members -> return a preview payload. Nothing here writes:
 * the whole module chain is read-only by construction.
 *
 * THE TAB IS FOUND, NOT ASSUMED. This module used to demand a tab literally
 * named "Sheet1". The app's own export puts its guest list on a tab named
 * "Guest Master", so the round trip the export is built for (see
 * src/lib/export/workbook.ts) failed at the door with `no sheet named
 * "Sheet1"` — the format mismatch this screen exists to prevent. Every tab is
 * now tried in turn and the first whose headers resolve the known layout wins,
 * so the legacy template (Sheet1) and the export (Guest Master) both read
 * without anybody renaming anything.
 *
 * When no tab resolves this returns a STRUCTURED failure naming exactly which
 * headers are missing, on the tab that came closest.
 */

import { parseFamilies, type ParsedFamilySheet, type ParseFamiliesOptions } from './families'
import {
  locateKnownLayout,
  type KnownLayout,
  type KnownLayoutFailure,
  type LayoutNote,
} from './layout'
import { KNOWN_SHEET_NAME, readWorkbookSheets, toSheetRows, type SheetGrid } from './parse'
import {
  contactsSheetFromGrid,
  parseContactsSheet,
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
 * a simple contacts sheet. Both share the `ParsedFamilySheet` result shape, so
 * the preview and commit paths are identical for both.
 */
export type ImportOutcome = KnownSheetSuccess | KnownSheetFailure | ContactsParseSuccess

interface LocatedKnownSheet {
  sheet: SheetGrid
  headerRowIndex: number
  layout: KnownLayout
  notes: LayoutNote[]
}

function isBlankCell(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === ''
}

/** The first row of a grid that has any non-blank cell, as header text. */
function firstHeaderRow(grid: unknown[][]): (string | null)[] {
  const row = grid.find((r) => (r ?? []).some((c) => !isBlankCell(c))) ?? []
  return row.map((c) => (isBlankCell(c) ? null : String(c)))
}

/**
 * The named tab first, then the rest in workbook order. Ordering decides which
 * tab wins when two resolve (the tab the caller named is the one they meant)
 * and it keeps the search deterministic. When the named tab is absent — the
 * export case — workbook order decides, and the export's guest list is first.
 */
function orderSheets(sheets: SheetGrid[], preferred: string): SheetGrid[] {
  const wanted = preferred.trim().toLowerCase()
  const index = sheets.findIndex((s) => s.sheetName.trim().toLowerCase() === wanted)
  if (index <= 0) return sheets
  return [sheets[index], ...sheets.slice(0, index), ...sheets.slice(index + 1)]
}

/** The first sheet whose headers resolve the known layout, if any. */
function findKnownSheet(sheets: SheetGrid[]): LocatedKnownSheet | null {
  for (const sheet of sheets) {
    const located = locateKnownLayout(sheet.grid)
    if (located.ok) {
      return {
        sheet,
        headerRowIndex: located.headerRowIndex,
        layout: located.layout,
        notes: located.notes,
      }
    }
  }
  return null
}
function knownSuccess(
  located: LocatedKnownSheet,
  availableSheets: string[],
  options: ParseFamiliesOptions,
): KnownSheetSuccess {
  const { headers, rows, blankRowsSkipped } = toSheetRows(
    located.sheet.grid,
    located.headerRowIndex,
  )

  return {
    ok: true,
    sheetName: located.sheet.sheetName,
    availableSheets,
    headerRowNumber: located.headerRowIndex + 1,
    headers,
    layout: located.layout,
    notes: located.notes,
    result: parseFamilies({ headers, rows, blankRowsSkipped }, located.layout, options),
  }
}

/**
 * The closest-matching tab, so the operator reads about real columns rather
 * than about a tab name. "Fewest missing columns" is the only ranking that
 * helps here: a sheet one header short is a sheet the operator can fix.
 */
function closestTab(
  sheets: SheetGrid[],
): { sheet: SheetGrid; failure: KnownLayoutFailure } | null {
  let best: { sheet: SheetGrid; failure: KnownLayoutFailure } | null = null
  for (const sheet of sheets) {
    const located = locateKnownLayout(sheet.grid)
    if (located.ok) continue
    if (!best || located.missing.length < best.failure.missing.length) {
      best = { sheet, failure: located }
    }
  }
  return best
}

function knownFailure(
  sheets: SheetGrid[],
  availableSheets: string[],
  preferred: string,
): KnownSheetFailure {
  if (sheets.length === 0) {
    return {
      ok: false,
      sheetName: preferred,
      availableSheets,
      headers: [],
      missing: [],
      reason: 'That workbook has no sheets.',
    }
  }

  const closest = closestTab(sheets)
  // `closestTab` returns null only when EVERY sheet resolves, which cannot be
  // the case here: `findKnownSheet` already ran, found nothing, and would have
  // returned. The first-tab fallback keeps the message truthful if that ever
  // stops being true.
  const sheet = closest?.sheet ?? sheets[0]
  const failure: KnownLayoutFailure = closest?.failure ?? {
    ok: false,
    missing: [],
    reason: 'That sheet has no rows to read a header from.',
  }
  const tabs =
    availableSheets.length > 0
      ? ` Tabs in this file: ${availableSheets.map((s) => `"${s}"`).join(', ')}.`
      : ''

  return {
    ok: false,
    sheetName: sheet.sheetName,
    availableSheets,
    headers: firstHeaderRow(sheet.grid),
    missing: failure.missing,
    reason: failure.reason + tabs,
  }
}
/**
 * Parses a workbook against the known layout, on whichever tab carries it.
 *
 * Never throws for a renamed or foreign tab: a workbook whose shape we cannot
 * read is a structured failure naming the missing headers, not an exception.
 * Only a genuinely unreadable file (not a workbook at all) rejects.
 */
export async function parseKnownWorkbook(
  file: File,
  options: ParseFamiliesOptions,
  sheetName: string = KNOWN_SHEET_NAME,
): Promise<KnownSheetOutcome> {
  const wb = await readWorkbookSheets(file)
  const ordered = orderSheets(wb.sheets, sheetName)
  const located = findKnownSheet(ordered)
  if (located) return knownSuccess(located, wb.availableSheets, options)
  return knownFailure(ordered, wb.availableSheets, sheetName)
}

/**
 * Parses a workbook against the known layout, then the contacts shape.
 *
 * Order matters: the known layout is the stricter, higher-value read (it
 * carries travel legs, pax and remarks), so a CALLING_MASTER_LIST file — or
 * the app's own export — must always be read as such. Only when it does not
 * resolve does the contacts fallback run, on each tab in turn; a two-column
 * Name/Contact sheet is the common case for a second event.
 */
export async function parseImportFile(
  file: File,
  options: ParseFamiliesOptions,
  sheetName: string = KNOWN_SHEET_NAME,
): Promise<ImportOutcome> {
  const wb = await readWorkbookSheets(file)
  const ordered = orderSheets(wb.sheets, sheetName)

  const located = findKnownSheet(ordered)
  if (located) return knownSuccess(located, wb.availableSheets, options)

  for (const sheet of ordered) {
    const resolved = contactsSheetFromGrid(sheet.sheetName, sheet.grid)
    if (!resolved.ok) continue
    const parsed = parseContactsSheet(resolved.sheet, options)
    if (parsed.ok) return parsed
  }

  // Neither layout resolved. The known-layout failure carries the full
  // missing-column list, which is the actionable one for a master-shaped file.
  return knownFailure(ordered, wb.availableSheets, sheetName)
}

export { SheetNotFoundError, KNOWN_SHEET_NAME } from './parse'