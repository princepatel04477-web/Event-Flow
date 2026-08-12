/**
 * Contacts-file path — a plain list of guests with a name and a phone number.
 *
 * This is the sheet the operator actually has: no "U" family number, no
 * SR.NO, no PLACE, no travel legs. Two columns, Name and Contact, every row
 * its own person. The CALLING_MASTER_LIST resolver rejects it by design —
 * twenty headers are "missing" — and telling the operator to hand-map the
 * columns into a fake master layout is busywork. So this module reads the
 * small shape directly and lifts each row into the SAME `ParsedFamilySheet`
 * structure the known-layout path produces, one person per family.
 *
 * Doing it that way means nothing downstream changes: the preview screen,
 * the warnings grouping and `app.commit_guest_import()` all consume
 * `ParsedFamilySheet` / `ParsedFamily[]` and do not care which layout
 * produced it. A contacts family has no arrival/departure legs (both blank
 * and `hasAnyValue: false`), a `Pax` of 1, and a family number derived from
 * its position in the sheet — enough for the `guest_groups` insert, which
 * needs a non-empty group code, and for the row hash, which is computed
 * from the same identifying cells as every other path.
 *
 * The number of required columns is deliberately the minimum a caller can
 * act on: NAME and CONTACT. City is accepted when present (it lands on
 * `guest_groups.city`) and ignored otherwise. Extra columns are ignored
 * wholesale — there is no known-layout ambiguity here because there are no
 * duplicated headers to mispair.
 *
 * Header detection is EXACT against a short alias list, same policy as
 * layout.ts: a guessed column means a whole column of phone numbers lands
 * on the wrong people, and the operator would not see it. When Name or
 * Contact cannot be found, the module says exactly which is missing.
 *
 * Pure: no DOM, no SheetJS, no Supabase — same rule as every other module
 * in src/lib/import.
 */

import {
  buildDateWindow,
  cleanPersonName,
  isBlankCell,
  rawCellText,
  rawRecord,
  type DateWindow,
} from './cells'
import {
  type ImportWarning,
  type OrphanRow,
  type ParsedFamily,
  type ParsedFamilySheet,
  type ParsedMember,
  type ParsedTravelLeg,
  type ParseFamiliesOptions,
  type RowExtras,
} from './families'
import { rowHash } from './hash'
import { normaliseMobile, normaliseText } from './normalize'
import type { LayoutNote } from './layout'
import { KNOWN_SHEET_NAME, readSheetGrid, type RawSheetRow } from './parse'

/** Header spellings accepted for the two columns a contacts sheet must have. */
const CONTACT_ALIASES = [
  'contact',
  'contact no',
  'contact number',
  'mobile',
  'mobile no',
  'mobile number',
  'phone',
  'phone no',
  'phone number',
  'number',
  'whatsapp',
  'whatsapp no',
]

const NAME_ALIASES = ['name', 'guest name', 'full name', 'names']

/** How a header cell is normalised before alias matching. */
function normaliseHeader(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
    .toLowerCase()
    .replace(/[_\-.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * A contacts sheet as read off disk. The header indexes are resolved here,
 * once, against the first non-empty row.
 */
export interface ContactsSheet {
  /** The tab the rows were read from, as named in the workbook. */
  sheetName: string
  headers: (string | null)[]
  /** 0-based column index of the Name column. */
  nameIndex: number
  /** 0-based column index of the Contact column. */
  contactIndex: number
  /** 0-based column index of a City/Place column, or null. */
  cityIndex: number | null
  /** Raw data rows, with true 1-based sheet row numbers. */
  rows: RawSheetRow[]
}

/** The header columns of a contacts sheet, before the workbook context is attached. */
export type ContactsColumns = Pick<
  ContactsSheet,
  'headers' | 'nameIndex' | 'contactIndex' | 'cityIndex'
>

export interface ContactsSheetFailure {
  ok: false
  /** Which of Name / Contact could not be found, for the message. */
  reason: string
}

export interface ContactsSheetSuccess {
  ok: true
  sheet: ContactsSheet
}

export type ContactsSheetResult = ContactsSheetFailure | ContactsSheetSuccess

/** The result of resolving just the header columns. */
export type ContactsColumnsResult = ContactsSheetFailure | { ok: true; sheet: ContactsColumns }

/**
 * Resolve the header row of a contacts sheet: exactly one Name column and
 * one Contact column, plus an optional City column. Never guesses.
 */
export function resolveContactsSheet(headers: (string | null)[]): ContactsColumnsResult {
  const norm = headers.map(normaliseHeader)

  const nameHits: number[] = []
  const contactHits: number[] = []
  norm.forEach((h, i) => {
    if (h && NAME_ALIASES.includes(h)) nameHits.push(i)
    if (h && CONTACT_ALIASES.includes(h)) contactHits.push(i)
  })

  if (nameHits.length === 0) {
    return { ok: false, reason: 'No column named "Name" was found — a contacts sheet needs one.' }
  }
  if (contactHits.length === 0) {
    return {
      ok: false,
      reason: 'No column named "Contact" (or "Mobile", "Phone", "Number") was found — a contacts sheet needs one.',
    }
  }
  if (nameHits.length > 1) {
    return { ok: false, reason: `"Name" appears ${nameHits.length} times — I cannot tell which column holds the name.` }
  }
  if (contactHits.length > 1) {
    return {
      ok: false,
      reason: `"Contact" appears ${contactHits.length} times (columns ${contactHits
        .map((i) => i + 1)
        .join(', ')}) — I cannot tell which column holds the number.`,
    }
  }

  const nameIndex = nameHits[0]
  const contactIndex = contactHits[0]

  // City is optional and only ever matched exactly; a sheet that happens to
  // label two columns "City" is not worth refusing over, the first wins.
  const cityIndex = norm.findIndex((h) => h === 'city' || h === 'place' || h === 'native place')

  return {
    ok: true,
    sheet: { headers, nameIndex, contactIndex, cityIndex: cityIndex >= 0 ? cityIndex : null },
  }
}

/**
 * Reads the named sheet off disk and resolves its contacts header row.
 *
 * Throws `SheetNotFoundError` when the tab is missing — same contract as
 * `readSheetGrid`, so the caller can distinguish "wrong tab" from "not a
 * contacts sheet".
 */
export async function readContactsSheet(
  file: File,
  sheetName: string = KNOWN_SHEET_NAME,
): Promise<ContactsSheetResult> {
  const { sheetName: resolvedName, grid } = await readSheetGrid(file, sheetName)

  // The header is the first row that has any non-blank cell.
  const headerRowIndex = grid.findIndex((row) => (row ?? []).some((c) => !isBlankCell(c)))
  if (headerRowIndex < 0) {
    return { ok: false, reason: `"${resolvedName}" is empty — there is no header row to read.` }
  }

  const headers = (grid[headerRowIndex] ?? []).map((h) => (isBlankCell(h) ? null : String(h)))

  const resolved = resolveContactsSheet(headers)
  if (!resolved.ok) return resolved

  const rows: RawSheetRow[] = []
  for (let i = headerRowIndex + 1; i < grid.length; i++) {
    const cells = grid[i] ?? []
    if (!cells.some((c) => !isBlankCell(c))) continue
    rows.push({ sheetRowNumber: i + 1, cells })
  }

  const sheet: ContactsSheet = { sheetName: resolvedName, ...resolved.sheet, rows }
  return { ok: true, sheet }
}

export interface ContactsParseFailure {
  ok: false
  reason: string
}

export interface ContactsParseSuccess {
  ok: true
  /** The tab the rows were read from, for the preview's "sheet" line. */
  sheetName: string
  /** Headers as read off the sheet, for the "closest row" line on failure. */
  headers: (string | null)[]
  /** The header row's 1-based number, matching `KnownSheetSuccess`. */
  headerRowNumber: number
  /** Notes for the preview (optional columns absent etc.). */
  notes: LayoutNote[]
  /** Exactly the same shape the known-layout path produces. */
  result: ParsedFamilySheet
}

export type ContactsParseOutcome = ContactsParseFailure | ContactsParseSuccess

/**
 * One entry point for the contacts path, mirroring `parseKnownWorkbook` in
 * knownSheet.ts so the import screen can try the known layout first and the
 * contacts shape second with a single outcome type.
 */
export async function parseContactsWorkbook(
  file: File,
  options: ParseFamiliesOptions,
  sheetName: string = KNOWN_SHEET_NAME,
): Promise<ContactsParseOutcome> {
  const sheet = await readContactsSheet(file, sheetName)
  if (!sheet.ok) return sheet

  return parseContactsSheet(sheet.sheet, options)
}

/** A blank travel leg — contacts sheets carry no arrival or departure info. */
const EMPTY_LEG = (): ParsedTravelLeg => ({
  direction: 'arrival',
  travelDate: null,
  travelDateRaw: null,
  travelTime: null,
  travelTimeRaw: null,
  mode: null,
  modeRaw: null,
  reference: null,
  point: null,
  hasAnyValue: false,
})

/**
 * Parse a contacts sheet into the standard family shape, one family per row.
 *
 * Written as its own loop rather than forcing the rows through
 * `parseFamilies`: a contacts sheet has no "U" column, no SR.NO and no
 * member rows, and synthesising those to reuse the known-layout parser
 * would mean inventing a layout — exactly the silent guess this codebase
 * refuses to make. The output shape is identical though, so the preview and
 * the commit path treat a contacts import the same as a master import.
 *
 * Warnings are the same ones the operator already reads: a family whose
 * phone cell will not reduce to 10 digits is `mobile_unreadable`, a blank
 * one is `mobile_missing`, a row with no name is `head_name_missing` and
 * blocks import. Everything else (city, extra columns) is kept verbatim on
 * the row's raw record and otherwise ignored.
 */
export function parseContactsSheet(
  sheet: ContactsSheet,
  options: ParseFamiliesOptions,
): ContactsParseOutcome {
  const { headers, nameIndex, contactIndex, cityIndex, rows } = sheet

  if (rows.length === 0) {
    return { ok: false, reason: 'That sheet has a Name and Contact header but no rows under them.' }
  }

  const window: DateWindow = buildDateWindow(options.eventStartsOn, options.eventEndsOn)

  const families: ParsedFamily[] = []
  const orphans: OrphanRow[] = []
  const warnings: ImportWarning[] = []

  rows.forEach((row, i) => {
    const cells = row.cells
    const familyNumber = String(i + 1)
    const familyWarnings: ImportWarning[] = []
    // The permanent record of what this row said — same builder the known-
    // layout path uses, so import_rows.raw loses nothing.
    const raw = rawRecord(headers, cells)

    const headNameRaw = rawCellText(cells[nameIndex] ?? null)
    const name = cleanPersonName(headNameRaw)
    if (name.value === null) {
      familyWarnings.push({
        code: 'head_name_missing',
        severity: 'critical',
        familyNumber,
        sheetRowNumber: row.sheetRowNumber,
        field: 'Name',
        rawValue: headNameRaw,
        action: 'Nothing was imported for this row — a guest must have a name.',
      })
    }

    const contactCell = cells[contactIndex] ?? null
    const mobile = normaliseMobile(contactCell)
    const contactRaw = rawCellText(contactCell)
    if (mobile.reason) {
      familyWarnings.push({
        code: 'mobile_unreadable',
        severity: 'warning',
        familyNumber,
        sheetRowNumber: row.sheetRowNumber,
        field: 'Contact',
        rawValue: contactRaw,
        action: `Left blank rather than guessed — the number ${mobile.reason}. This guest cannot be dialled until it is fixed.`,
      })
    } else if (mobile.value === null) {
      familyWarnings.push({
        code: 'mobile_missing',
        severity: 'warning',
        familyNumber,
        sheetRowNumber: row.sheetRowNumber,
        field: 'Contact',
        rawValue: null,
        action: 'Imported with no phone number — this guest cannot be dialled.',
      })
    }

    const cityRaw = cityIndex === null ? null : cells[cityIndex] ?? null
    const place = normaliseText(cityRaw)
    const primaryMobile = mobile.value
    const headName = name.value

    const members: ParsedMember[] = []
    if (headName !== null) {
      members.push({
        fullName: headName,
        rawName: headNameRaw,
        sourceRowIndex: row.sheetRowNumber,
        isHead: true,
        serialNumber: null,
        extras: { id: null, room: null, bed: null } satisfies RowExtras,
        raw,
      })
    }

    const family: ParsedFamily = {
      familyNumber,
      familyIndex: i + 1,
      sourceRowIndex: row.sheetRowNumber,
      sheetRowNumbers: [row.sheetRowNumber],
      hash: rowHash({ headName: headName ?? '', groupCode: familyNumber, primaryMobile }),
      headName,
      headNameRaw,
      place,
      primaryMobile,
      primaryMobileRaw: contactRaw,
      expectedPax: 1,
      memberCount: members.length,
      remark: null,
      rsvpStatus: 'not_started',
      arrival: { ...EMPTY_LEG(), direction: 'arrival' },
      departure: { ...EMPTY_LEG(), direction: 'departure' },
      members,
      extras: { id: null, room: null, bed: null } satisfies RowExtras,
      raw,
      warnings: familyWarnings,
      canImport: headName !== null,
      blockReason:
        headName !== null ? null : 'This row has no name, and a family cannot be created without one.',
    }

    families.push(family)
    warnings.push(...familyWarnings)
  })

  return {
    ok: true,
    sheetName: sheet.sheetName,
    headers,
    headerRowNumber: 1,
    notes: [] as LayoutNote[],
    result: {
      families,
      orphans,
      warnings,
      dateWindow: window,
      counts: {
        sheetRows: rows.length,
        blankRowsSkipped: 0,
        families: families.length,
        members: families.reduce((n, f) => n + f.members.length, 0),
        orphans: orphans.length,
        warnings: warnings.length,
        criticalWarnings: warnings.filter((w) => w.severity === 'critical').length,
        blockedFamilies: families.filter((f) => !f.canImport).length,
      },
    },
  }
}

export { KNOWN_SHEET_NAME, SheetNotFoundError } from './parse'
