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
import { normaliseMobile, normaliseText, parsePax } from './normalize'
import type { LayoutNote } from './layout'
import { KNOWN_SHEET_NAME, readSheetGrid, type RawSheetRow } from './parse'

/** Header spellings accepted for the contact / mobile column. */
export const CONTACT_ALIASES = [
  'contact',
  'contact no',
  'contact number',
  'contact num',
  'mobile',
  'mobile no',
  'mobile number',
  'mobile num',
  'phone',
  'phone no',
  'phone number',
  'phone num',
  'number',
  'tel',
  'telephone',
  'cell',
  'cell no',
  'cellular',
  'whatsapp',
  'whatsapp no',
  'whatsapp number',
  'mob',
  'mob no',
  'ph',
  'ph no',
  'calling no',
  'calling number',
  'primary mobile',
  'handphone',
  'contact details',
  'phone details',
  'mobile details',
]

/**
 * Name spellings accepted for the guest name column.
 */
export const NAME_ALIASES = [
  'name',
  'names',
  'guest',
  'guest name',
  'guest names',
  'guestname',
  'full name',
  'fullname',
  'head name',
  'head',
  'family head',
  'family name',
  'contact name',
  'invitee',
  'invitee name',
  'invitees',
  'attendee',
  'attendee name',
  'attendees',
  'person',
  'person name',
  'member',
  'member name',
  'members',
  'client',
  'client name',
  'lead guest',
  'primary guest',
  'first name',
  'firstname',
  'guest(s)',
]

export const PAX_ALIASES = [
  'pax',
  'no of pax',
  'total pax',
  'headcount',
  'expected pax',
  'guests',
  'no of guests',
  'number of guests',
  'members',
  'people',
  'count',
  'size',
  'group size',
  'adults',
  'seats',
]

export const CITY_ALIASES = [
  'city',
  'place',
  'native place',
  'location',
  'town',
  'from city',
  'address',
  'native',
  'city/town',
]

export const REMARKS_ALIASES = [
  'remark',
  'remarks',
  'note',
  'notes',
  'comment',
  'comments',
  'status remark',
  'rsvp remarks',
]

export const GROUP_CODE_ALIASES = [
  'group code',
  'groupcode',
  'family code',
  'family id',
  'group id',
  'group no',
  'family no',
  'sr no',
  'sr. no',
  'srno',
  's no',
  'sno',
  'u',
  'u no',
  'serial',
  'serial no',
  'code',
  'id',
]

export const ROOM_ALIASES = [
  'room',
  'romm',
  'room no',
  'room number',
  'room#',
]

/** How a header cell is normalised before alias matching. */
export function normaliseHeader(value: unknown): string {
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
  headerRowIndex?: number
  /** 0-based column index of the Name column. */
  nameIndex: number
  /** 0-based column index of the Contact column, or null if sheet has no phone column. */
  contactIndex: number | null
  /** 0-based column index of a City/Place column, or null. */
  cityIndex: number | null
  /** 0-based column index of a Pax/Headcount column, or null. */
  paxIndex?: number | null
  /** 0-based column index of a Group code/Family no column, or null. */
  groupCodeIndex?: number | null
  /** 0-based column index of a Remarks column, or null. */
  remarksIndex?: number | null
  /** 0-based column index of a Room column, or null. */
  roomIndex?: number | null
  /** Raw data rows, with true 1-based sheet row numbers. */
  rows: RawSheetRow[]
}

/** The header columns of a contacts sheet, before the workbook context is attached. */
export type ContactsColumns = Pick<
  ContactsSheet,
  'headers' | 'nameIndex' | 'contactIndex' | 'cityIndex' | 'paxIndex' | 'groupCodeIndex' | 'remarksIndex' | 'roomIndex'
>

export interface ContactsSheetFailure {
  ok: false
  /** Why it could not be resolved, for the message. */
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
 * Resolve the header row of a contacts sheet: finds a Name column, an optional Contact column,
 * plus optional City, Pax, Group Code, Remarks and Room columns.
 */
export function resolveContactsSheet(
  headers: (string | null)[],
  options?: { requireContact?: boolean },
): ContactsColumnsResult {
  const norm = headers.map(normaliseHeader)

  const nameHits: number[] = []
  const contactHits: number[] = []
  norm.forEach((h, i) => {
    if (h && NAME_ALIASES.includes(h)) nameHits.push(i)
    if (h && CONTACT_ALIASES.includes(h)) contactHits.push(i)
  })

  if (nameHits.length === 0) {
    return { ok: false, reason: 'No column named "Name" (or "Guest Name") was found — a guest sheet needs one.' }
  }

  if (nameHits.length > 1) {
    return {
      ok: false,
      reason: `"Name" appears ${nameHits.length} times — I cannot tell which column holds the name.`,
    }
  }

  const requireContact = options?.requireContact ?? true
  if (contactHits.length > 1) {
    return {
      ok: false,
      reason: `"Contact" appears ${contactHits.length} times — I cannot tell which column holds the phone number.`,
    }
  }

  if (requireContact && contactHits.length === 0) {
    return {
      ok: false,
      reason: 'No column named "Contact" (or "Mobile", "Phone", "Number") was found — a contacts sheet needs one.',
    }
  }

  const nameIndex = nameHits[0]
  const contactIndex = contactHits.length > 0 ? contactHits[0] : null

  const claimed = new Set<number>([nameIndex])
  if (contactIndex !== null) claimed.add(contactIndex)

  const cityIdx = norm.findIndex((h, i) => !claimed.has(i) && h && CITY_ALIASES.includes(h))
  const cityIndex = cityIdx >= 0 ? cityIdx : null
  if (cityIndex !== null) claimed.add(cityIndex)

  const paxIdx = norm.findIndex((h, i) => !claimed.has(i) && h && PAX_ALIASES.includes(h))
  const paxIndex = paxIdx >= 0 ? paxIdx : null
  if (paxIndex !== null) claimed.add(paxIndex)

  const groupCodeIdx = norm.findIndex((h, i) => !claimed.has(i) && h && GROUP_CODE_ALIASES.includes(h))
  const groupCodeIndex = groupCodeIdx >= 0 ? groupCodeIdx : null
  if (groupCodeIndex !== null) claimed.add(groupCodeIndex)

  const remarksIdx = norm.findIndex((h, i) => !claimed.has(i) && h && REMARKS_ALIASES.includes(h))
  const remarksIndex = remarksIdx >= 0 ? remarksIdx : null
  if (remarksIndex !== null) claimed.add(remarksIndex)

  const roomIdx = norm.findIndex((h, i) => !claimed.has(i) && h && ROOM_ALIASES.includes(h))
  const roomIndex = roomIdx >= 0 ? roomIdx : null

  return {
    ok: true,
    sheet: {
      headers,
      nameIndex,
      contactIndex,
      cityIndex,
      paxIndex,
      groupCodeIndex,
      remarksIndex,
      roomIndex,
    },
  }
}

/**
 * Resolves a raw grid that has ALREADY been read off disk: scans candidate rows (up to maxScanRows)
 * to find the true header row, resolve columns, and collect data rows beneath it.
 */
export function resolveContactsGrid(
  grid: unknown[][],
  sheetName: string,
  maxScanRows = 15,
  options?: { requireContact?: boolean },
): ContactsSheetResult {
  const limit = Math.min(grid.length, maxScanRows)
  const requireContactFirst = options?.requireContact ?? true

  // Pass 1: Try finding a header row with requireContact (standard contacts sheets with Name & Phone)
  for (let r = 0; r < limit; r++) {
    const row = grid[r] ?? []
    if (!row.some((c) => !isBlankCell(c))) continue

    const headers = row.map((h) => (isBlankCell(h) ? null : String(h)))
    const resolved = resolveContactsSheet(headers, { requireContact: requireContactFirst })
    if (resolved.ok) {
      const rows: RawSheetRow[] = []
      for (let i = r + 1; i < grid.length; i++) {
        const cells = grid[i] ?? []
        if (!cells.some((c) => !isBlankCell(c))) continue
        rows.push({ sheetRowNumber: i + 1, cells })
      }

      const sheet: ContactsSheet = {
        sheetName,
        headerRowIndex: r,
        ...resolved.sheet,
        rows,
      }
      return { ok: true, sheet }
    }
  }

  // Pass 2: If requireContact was not explicitly forced true by caller, try scanning without requiring Contact
  if (options?.requireContact === undefined && requireContactFirst) {
    for (let r = 0; r < limit; r++) {
      const row = grid[r] ?? []
      if (!row.some((c) => !isBlankCell(c))) continue

      const headers = row.map((h) => (isBlankCell(h) ? null : String(h)))
      const resolved = resolveContactsSheet(headers, { requireContact: false })
      if (resolved.ok) {
        const rows: RawSheetRow[] = []
        for (let i = r + 1; i < grid.length; i++) {
          const cells = grid[i] ?? []
          if (!cells.some((c) => !isBlankCell(c))) continue
          rows.push({ sheetRowNumber: i + 1, cells })
        }

        const sheet: ContactsSheet = {
          sheetName,
          headerRowIndex: r,
          ...resolved.sheet,
          rows,
        }
        return { ok: true, sheet }
      }
    }
  }

  // If still not resolved, return failure reason from the first non-empty row
  for (let r = 0; r < limit; r++) {
    const row = grid[r] ?? []
    if (!row.some((c) => !isBlankCell(c))) continue
    const headers = row.map((h) => (isBlankCell(h) ? null : String(h)))
    const resolved = resolveContactsSheet(headers, options)
    if (!resolved.ok) {
      return resolved
    }
  }

  return { ok: false, reason: `"${sheetName}" is empty — there is no header row to read.` }
}

/**
 * Reads the named sheet off disk and resolves its contacts header row.
 */
export async function readContactsSheet(
  file: File,
  sheetName: string = KNOWN_SHEET_NAME,
): Promise<ContactsSheetResult> {
  const { sheetName: resolvedName, grid } = await readSheetGrid(file, sheetName)
  return resolveContactsGrid(grid, resolvedName)
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
 * One entry point for the contacts path.
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
 */
export function parseContactsSheet(
  sheet: ContactsSheet,
  options: ParseFamiliesOptions,
): ContactsParseOutcome {
  const { headers, nameIndex, contactIndex, cityIndex, paxIndex, groupCodeIndex, remarksIndex, roomIndex, rows } = sheet

  if (rows.length === 0) {
    return { ok: false, reason: 'That sheet has headers but no rows under them.' }
  }

  const window: DateWindow = buildDateWindow(options.eventStartsOn, options.eventEndsOn)

  const families: ParsedFamily[] = []
  const orphans: OrphanRow[] = []
  const warnings: ImportWarning[] = []
  const notes: LayoutNote[] = []

  if (contactIndex === null) {
    notes.push({
      column: 'contact',
      label: 'Phone number',
      detail: 'not in this sheet — guests will be imported with no phone number.',
    })
  }

  if (paxIndex === null || paxIndex === undefined) {
    notes.push({
      column: 'pax',
      label: 'Pax (headcount)',
      detail: 'not in this sheet — defaulted to 1 pax per family.',
    })
  }

  rows.forEach((row, i) => {
    const cells = row.cells
    const groupCodeRaw = groupCodeIndex != null ? cells[groupCodeIndex] : null
    const familyNumber =
      groupCodeRaw !== null && groupCodeRaw !== undefined && String(groupCodeRaw).trim() !== ''
        ? String(groupCodeRaw).trim()
        : String(i + 1)

    const familyWarnings: ImportWarning[] = []
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

    const contactCell = contactIndex !== null ? cells[contactIndex] ?? null : null
    const mobile = normaliseMobile(contactCell)
    const contactRaw = rawCellText(contactCell)
    if (contactIndex !== null) {
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
    }

    const cityRaw = cityIndex === null ? null : cells[cityIndex] ?? null
    const place = normaliseText(cityRaw)
    const primaryMobile = mobile.value
    const headName = name.value

    const paxRaw = paxIndex != null ? cells[paxIndex] : null
    const paxParsed = paxRaw !== null && paxRaw !== undefined ? parsePax(paxRaw) : null
    const expectedPax = paxParsed ?? 1

    const remarkRaw = remarksIndex != null ? cells[remarksIndex] : null
    const remark = normaliseText(remarkRaw)

    const roomRaw = roomIndex != null ? cells[roomIndex] : null
    const room = normaliseText(roomRaw)
    const extras: RowExtras = { id: null, room, bed: null }

    const members: ParsedMember[] = []
    if (headName !== null) {
      members.push({
        fullName: headName,
        rawName: headNameRaw,
        sourceRowIndex: row.sheetRowNumber,
        isHead: true,
        serialNumber: null,
        extras,
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
      expectedPax,
      memberCount: members.length,
      remark,
      rsvpStatus: 'not_started',
      arrival: { ...EMPTY_LEG(), direction: 'arrival' },
      departure: { ...EMPTY_LEG(), direction: 'departure' },
      members,
      extras,
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
    headerRowNumber: (sheet.headerRowIndex ?? 0) + 1,
    notes,
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

/**
 * Parses a sheet using explicitly user-defined or verified column mappings.
 */
export function parseCustomMapping(
  grid: unknown[][],
  sheetName: string,
  headerRowIndex: number,
  mapping: {
    nameIndex: number
    contactIndex?: number | null
    paxIndex?: number | null
    cityIndex?: number | null
    groupCodeIndex?: number | null
    remarksIndex?: number | null
    roomIndex?: number | null
  },
  options: ParseFamiliesOptions,
): ContactsParseOutcome {
  const headerRow = grid[headerRowIndex] ?? []
  const headers = headerRow.map((h) => (isBlankCell(h) ? null : String(h)))

  const rows: RawSheetRow[] = []
  for (let i = headerRowIndex + 1; i < grid.length; i++) {
    const cells = grid[i] ?? []
    if (!cells.some((c) => !isBlankCell(c))) continue
    rows.push({ sheetRowNumber: i + 1, cells })
  }

  const sheet: ContactsSheet = {
    sheetName,
    headers,
    headerRowIndex,
    nameIndex: mapping.nameIndex,
    contactIndex: mapping.contactIndex ?? null,
    cityIndex: mapping.cityIndex ?? null,
    paxIndex: mapping.paxIndex ?? null,
    groupCodeIndex: mapping.groupCodeIndex ?? null,
    remarksIndex: mapping.remarksIndex ?? null,
    roomIndex: mapping.roomIndex ?? null,
    rows,
  }

  return parseContactsSheet(sheet, options)
}

export { KNOWN_SHEET_NAME, SheetNotFoundError } from './parse'
