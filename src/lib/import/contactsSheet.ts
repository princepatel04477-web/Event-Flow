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
import {
  normaliseMobile,
  normaliseText,
  normaliseSide,
  parsePax,
  parseSubSide,
  resolveImportedSide,
  type NormalisedSide,
  type SubSide,
} from './normalize'
import type { LayoutNote } from './layout'
import { KNOWN_SHEET_NAME, readSheetGrid, type RawSheetRow, type RowComments } from './parse'

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
  'mo no',
  'mono',
  'm no',
  'mno',
  'mbl',
  'mbl no',
  'calling no',
  'calling number',
  'calling mobile',
  'primary mobile',
  'primary phone',
  'primary contact',
  'handphone',
  'contact details',
  'phone details',
  'mobile details',
  'mobile whatsapp',
  'whatsapp mobile',
  'phone whatsapp',
  'whatsapp phone',
  'contact mobile',
  'mobile contact',
  'calling whatsapp',
  'whatsapp calling',
  'phone mobile',
  'mobile phone',
  'mobile 1',
  'phone 1',
  'contact 1',
  'mobile calling',
  'phone calling',
  'cell phone',
  'contact dial',
  'dial',
]

/** Priority order when multiple contact columns match in a sheet. */
export const CONTACT_PRIORITY = [
  // "Calling Number" is the column a client fills in FOR the callers; when a
  // sheet also has "Whatsapp Number", that one is the fallback, not the dial.
  'calling no',
  'calling number',
  'calling mobile',
  'primary mobile',
  'primary phone',
  'primary contact',
  'mobile',
  'mobile no',
  'mobile number',
  'phone',
  'phone no',
  'phone number',
  'contact',
  'contact no',
  'contact number',
  'cell',
  'cell no',
  'telephone',
  'whatsapp',
  'whatsapp no',
  'whatsapp number',
]

/**
 * Checks whether a normalised header represents a contact / mobile column.
 * Handles compound headers like "Mobile / WhatsApp" and keywords.
 */
export function isContactHeader(norm: string): boolean {
  if (!norm) return false
  if (CONTACT_ALIASES.includes(norm)) return true

  // Negative checks: exclude headers that clearly mean something else
  if (
    /\b(name|person|address|city|email|mail|status|remark|note|id|code|pax|headcount|date|time|mode|details)\b/i.test(
      norm,
    )
  ) {
    return false
  }

  // Positive checks: keywords or abbreviations indicating a phone/contact number
  return (
    /\b(mobile|phone|whatsapp|cell|telephon|calling|dial|contact)\b/i.test(norm) ||
    /\b(mo|ph|mob|mbl|m)\s*(no|num|number)\b/i.test(norm) ||
    /^(mo|mob|ph)\b/i.test(norm)
  )
}

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
  'seats',
  'total',
  'total guests',
  'total guest',
  'total persons',
  'persons',
  'no of persons',
  'family members',
]

/**
 * Split headcount. When a sheet has Adult + Kids (and no total column), pax
 * is their sum — taking the Adult cell alone undercounts every family with
 * children, and that number is what rooms and vehicles are planned against.
 */
export const ADULT_ALIASES = ['adult', 'adults', 'no of adults', 'adult pax', 'adults pax']
export const KIDS_ALIASES = [
  'kid',
  'kids',
  'child',
  'children',
  'childs',
  'no of kids',
  'no of children',
  'kids pax',
  'child pax',
]

/** "Relation" (Brother, Bhatiji, Family Friend…) — the caller's context. */
export const RELATION_ALIASES = [
  'relation',
  'relations',
  'relationship',
  'relation with',
  'relation to',
  'rel',
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
  'remarks notes',
  'remark notes',
  'remark note',
  'notes remarks',
  'special notes',
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

export const SIDE_ALIASES = [
  'side',
  'family side',
  'guest side',
  'wedding side',
  'bride groom',
  'bride or groom',
  'party',
]

export const SUB_SIDE_ALIASES = [
  'sub side',
  'subside',
  'branch',
  'family branch',
  'parent side',
  'father mother',
  'lineage',
  'relation side',
]

/** How a header cell is normalised before alias matching. */
export function normaliseHeader(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
    .toLowerCase()
    .replace(/[/\\&(),:;#_\-.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Detects which column contains phone numbers by inspecting data cells in the grid.
 * Scans up to sampleRowCount non-empty rows beneath the header and tests for valid 10-digit mobile numbers.
 */
export function detectContactColumnFromData(
  grid: unknown[][],
  headerRowIndex: number,
  excludeColumns?: Set<number>,
  sampleRowCount = 30,
): number | null {
  if (!grid || grid.length <= headerRowIndex + 1) return null

  const startRow = headerRowIndex + 1
  const endRow = Math.min(grid.length, startRow + sampleRowCount)

  let maxCols = 0
  for (let r = startRow; r < endRow; r++) {
    const row = grid[r]
    if (row && row.length > maxCols) maxCols = row.length
  }

  let bestCol: number | null = null
  let bestScore = 0

  for (let col = 0; col < maxCols; col++) {
    if (excludeColumns?.has(col)) continue

    let validPhones = 0
    let nonBlank = 0

    for (let r = startRow; r < endRow; r++) {
      const cell = grid[r]?.[col]
      if (isBlankCell(cell)) continue
      nonBlank++

      const norm = normaliseMobile(cell)
      if (norm.value) {
        validPhones++
      } else {
        const digits = String(cell).replace(/\D/g, '')
        if (digits.length >= 10 && digits.length <= 13) {
          validPhones++
        }
      }
    }

    if (nonBlank > 0 && validPhones > 0) {
      const ratio = validPhones / nonBlank
      if (ratio >= 0.3) {
        const score = ratio * 100 + validPhones
        if (score > bestScore) {
          bestScore = score
          bestCol = col
        }
      }
    }
  }

  return bestCol
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
  /** 0-based column index of a Side (Groom / Bride) column, or null. */
  sideIndex?: number | null
  /** 0-based column index of a Sub-side (Father / Mother) column, or null. */
  subSideIndex?: number | null
  /** A second phone column (WhatsApp, when Calling is the primary), or null. */
  altContactIndex?: number | null
  /** Adult / Kids split headcount columns — summed into pax when no total. */
  adultsIndex?: number | null
  kidsIndex?: number | null
  /** "Relation" column, folded into the remarks the caller sees. */
  relationIndex?: number | null
  /** Excel cell notes by 0-based grid row — see `RowComments`. */
  rowComments?: RowComments
  /** Raw data rows, with true 1-based sheet row numbers. */
  rows: RawSheetRow[]
}

/** The header columns of a contacts sheet, before the workbook context is attached. */
export type ContactsColumns = Pick<
  ContactsSheet,
  | 'headers'
  | 'nameIndex'
  | 'contactIndex'
  | 'cityIndex'
  | 'paxIndex'
  | 'groupCodeIndex'
  | 'remarksIndex'
  | 'roomIndex'
  | 'sideIndex'
  | 'subSideIndex'
  | 'altContactIndex'
  | 'adultsIndex'
  | 'kidsIndex'
  | 'relationIndex'
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
    if (h && isContactHeader(h)) contactHits.push(i)
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

  // Several phone columns (Calling + WhatsApp, Mobile + Alt): rank them by
  // CONTACT_PRIORITY — stable, so equal ranks keep sheet order. The winner is
  // dialled; the runner-up becomes the alternate number.
  const rankedContacts = [...contactHits].sort((a, b) => {
    const pa = CONTACT_PRIORITY.indexOf(norm[a])
    const pb = CONTACT_PRIORITY.indexOf(norm[b])
    return (pa >= 0 ? pa : 1000) - (pb >= 0 ? pb : 1000)
  })
  const contactIndex: number | null = rankedContacts[0] ?? null
  const altContactIndex: number | null = rankedContacts[1] ?? null

  const requireContact = options?.requireContact ?? true
  if (requireContact && contactIndex === null) {
    return {
      ok: false,
      reason: 'No column named "Contact" (or "Mobile", "Phone", "Number") was found — a contacts sheet needs one.',
    }
  }

  const nameIndex = nameHits[0]
  const claimed = new Set<number>([nameIndex])
  if (contactIndex !== null) claimed.add(contactIndex)
  if (altContactIndex !== null) claimed.add(altContactIndex)

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
  if (roomIndex !== null) claimed.add(roomIndex)

  const sideIdx = norm.findIndex((h, i) => !claimed.has(i) && h && SIDE_ALIASES.includes(h))
  const sideIndex = sideIdx >= 0 ? sideIdx : null
  if (sideIndex !== null) claimed.add(sideIndex)

  const subSideIdx = norm.findIndex((h, i) => !claimed.has(i) && h && SUB_SIDE_ALIASES.includes(h))
  const subSideIndex = subSideIdx >= 0 ? subSideIdx : null
  if (subSideIndex !== null) claimed.add(subSideIndex)

  const pick = (aliases: string[]): number | null => {
    const idx = norm.findIndex((h, i) => !claimed.has(i) && h && aliases.includes(h))
    if (idx < 0) return null
    claimed.add(idx)
    return idx
  }
  const adultsIndex = pick(ADULT_ALIASES)
  const kidsIndex = pick(KIDS_ALIASES)
  const relationIndex = pick(RELATION_ALIASES)

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
      sideIndex,
      subSideIndex,
      altContactIndex,
      adultsIndex,
      kidsIndex,
      relationIndex,
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
  options?: { requireContact?: boolean; comments?: RowComments },
): ContactsSheetResult {
  const limit = Math.min(grid.length, maxScanRows)
  const requireContactFirst = options?.requireContact ?? true

  interface Candidate {
    headerRowIndex: number
    resolved: ContactsColumns
    hasPhone: boolean
    dataRowCount: number
  }

  const candidates: Candidate[] = []

  for (let r = 0; r < limit; r++) {
    const row = grid[r] ?? []
    if (!row.some((c) => !isBlankCell(c))) continue

    const headers = row.map((h) => (isBlankCell(h) ? null : String(h)))
    const resolved = resolveContactsSheet(headers, { requireContact: false })
    if (resolved.ok) {
      let contactIndex = resolved.sheet.contactIndex
      // If contact was not found from headers, try data-driven detection from cells below
      if (contactIndex === null) {
        const detectedCol = detectContactColumnFromData(
          grid,
          r,
          new Set([resolved.sheet.nameIndex]),
        )
        if (detectedCol !== null) {
          contactIndex = detectedCol
          resolved.sheet.contactIndex = detectedCol
        }
      }

      // Count data rows below this header
      let dataRowCount = 0
      for (let i = r + 1; i < grid.length; i++) {
        const cells = grid[i] ?? []
        if (cells.some((c) => !isBlankCell(c))) dataRowCount++
      }

      candidates.push({
        headerRowIndex: r,
        resolved: resolved.sheet,
        hasPhone: contactIndex !== null,
        dataRowCount,
      })
    }
  }

  let viable = candidates
  if (options?.requireContact === true) {
    viable = candidates.filter((c) => c.hasPhone)
  } else if (requireContactFirst) {
    const withPhone = candidates.filter((c) => c.hasPhone)
    if (withPhone.length > 0) {
      viable = withPhone
    }
  }

  if (viable.length > 0) {
    viable.sort((a, b) => {
      if (a.hasPhone !== b.hasPhone) return a.hasPhone ? -1 : 1
      if (b.dataRowCount !== a.dataRowCount) return b.dataRowCount - a.dataRowCount
      return a.headerRowIndex - b.headerRowIndex
    })

    const best = viable[0]
    const r = best.headerRowIndex
    const rows: RawSheetRow[] = []
    for (let i = r + 1; i < grid.length; i++) {
      const cells = grid[i] ?? []
      if (!cells.some((c) => !isBlankCell(c))) continue
      rows.push({ sheetRowNumber: i + 1, cells })
    }

    const sheet: ContactsSheet = {
      sheetName,
      headerRowIndex: r,
      ...best.resolved,
      rowComments: options?.comments,
      rows,
    }
    return { ok: true, sheet }
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

/**
 * Every dialable number in one phone cell. Real sheets put two numbers in a
 * cell — "9414075324, 9214078324" with a "Call Both" note — and the strict
 * normaliser rightly refuses a 20-digit string. Split on the separators
 * people actually type, keep each piece that is a real 10-digit number, and
 * report the cell as unreadable only when NOTHING in it was usable.
 */
export function splitMobiles(cell: unknown): { numbers: string[]; reason: string | null } {
  if (isBlankCell(cell)) return { numbers: [], reason: null }
  const whole = normaliseMobile(cell)
  if (whole.value) return { numbers: [whole.value], reason: null }
  if (typeof cell !== 'string') return { numbers: [], reason: whole.reason }

  const pieces = cell.split(/[,;/|&\n]+|\s+or\s+|\s{2,}/i).filter((p) => p.trim() !== '')
  if (pieces.length < 2) return { numbers: [], reason: whole.reason }
  const numbers: string[] = []
  for (const piece of pieces) {
    const one = normaliseMobile(piece)
    if (one.value && !numbers.includes(one.value)) numbers.push(one.value)
  }
  return numbers.length > 0 ? { numbers, reason: null } : { numbers: [], reason: whole.reason }
}

/**
 * A section heading inside the list — "Father Side", "MOTHER SIDE",
 * "Bride Side" — sitting alone on its row (often merged across the columns).
 * It is not a guest: it labels the rows under it. Returns the side it names,
 * or null for an ordinary row. The lone-cell + "side" word requirement is what
 * keeps a guest called "Mama" or "Papa Ji" from being mistaken for one.
 */
export function sectionHeading(cells: unknown[]): { text: string; side: NormalisedSide | null; subSide: SubSide | null } | null {
  const filled = cells.filter((c) => !isBlankCell(c))
  if (filled.length !== 1 || typeof filled[0] !== 'string') return null
  const text = filled[0].replace(/\s+/g, ' ').trim()
  if (text.length > 40 || !/\b(side|paksh|paksha)\b/i.test(text)) return null
  // Not parseSideAndSubSide: it reads "Father Side" as side 'other' and then
  // drops the father branch. A heading names a side only when it says
  // bride/groom/both; the branch is read on its own.
  const side = /\b(bride|groom|both)\b/i.test(text) ? normaliseSide(text) : null
  const subSide = side === 'both' ? null : parseSubSide(text)
  if (!side && !subSide) return null
  return { text, side, subSide }
}

/** "Mother Side Subtotal", "GRAND TOTAL (ALL GUESTS)", "Total" — a sum, not a family. */
export function isTotalsRow(nameText: string | null): boolean {
  if (!nameText) return false
  return /\b(sub\s*-?\s*total|grand\s*total)\b/i.test(nameText) || /^\s*total\b/i.test(nameText)
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
  const {
    headers,
    nameIndex,
    contactIndex,
    cityIndex,
    paxIndex,
    groupCodeIndex,
    remarksIndex,
    roomIndex,
    sideIndex,
    subSideIndex,
    altContactIndex = null,
    adultsIndex = null,
    kidsIndex = null,
    relationIndex = null,
    rowComments,
    rows,
  } = sheet

  if (rows.length === 0) {
    return { ok: false, reason: 'That sheet has headers but no rows under them.' }
  }

  const window: DateWindow = buildDateWindow(options.eventStartsOn, options.eventEndsOn)

  const families: ParsedFamily[] = []
  const orphans: OrphanRow[] = []
  const warnings: ImportWarning[] = []
  const notes: LayoutNote[] = []

  const hasHeadcount = paxIndex != null || adultsIndex != null || kidsIndex != null

  if (contactIndex === null) {
    notes.push({
      column: 'contact',
      label: 'Phone number',
      detail: 'not in this sheet — guests will be imported with no phone number.',
    })
  } else if (altContactIndex !== null) {
    notes.push({
      column: 'contact',
      label: 'Phone number',
      detail: `dialled from "${headers[contactIndex] ?? ''}". "${headers[altContactIndex] ?? ''}" is kept as the alternate number, and used when the first is blank.`,
    })
  }

  if (!hasHeadcount) {
    notes.push({
      column: 'pax',
      label: 'Pax (headcount)',
      detail: 'not in this sheet — defaulted to 1 pax per family.',
    })
  } else if (paxIndex == null && adultsIndex != null) {
    notes.push({
      column: 'pax',
      label: 'Pax (headcount)',
      detail:
        kidsIndex != null
          ? `"${headers[adultsIndex] ?? ''}" + "${headers[kidsIndex] ?? ''}" added together.`
          : `taken from "${headers[adultsIndex] ?? ''}".`,
    })
  }

  // A section heading ("Father Side") sets the side for the rows under it,
  // until the next heading. A Side column on the row itself still wins.
  let section: { side: NormalisedSide | null; subSide: SubSide | null } | null = null
  const sectionsSeen: string[] = []
  const totalsSkipped: number[] = []
  let familyCount = 0

  const cellText = (cells: unknown[], idx: number | null | undefined): string | null =>
    idx == null ? null : normaliseText(cells[idx] ?? null)

  rows.forEach((row) => {
    const cells = row.cells

    const heading = sectionHeading(cells)
    if (heading) {
      section = { side: heading.side, subSide: heading.subSide }
      sectionsSeen.push(`"${heading.text}" (row ${row.sheetRowNumber})`)
      return
    }
    if (isTotalsRow(rawCellText(cells[nameIndex] ?? null))) {
      totalsSkipped.push(row.sheetRowNumber)
      return
    }

    familyCount += 1
    const groupCodeRaw = groupCodeIndex != null ? cells[groupCodeIndex] : null
    const familyNumber =
      groupCodeRaw !== null && groupCodeRaw !== undefined && String(groupCodeRaw).trim() !== ''
        ? String(groupCodeRaw).trim()
        : String(familyCount)

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

    // Phones: the dial column first, then the alternate column. The first
    // usable number is dialled, the next distinct one is the alternate.
    const contactCell = contactIndex !== null ? cells[contactIndex] ?? null : null
    const altCell = altContactIndex !== null ? cells[altContactIndex] ?? null : null
    const fromContact = splitMobiles(contactCell)
    const fromAlt = splitMobiles(altCell)
    const allNumbers = [...fromContact.numbers, ...fromAlt.numbers].filter(
      (n, idx, arr) => arr.indexOf(n) === idx,
    )
    const primaryMobile = allNumbers[0] ?? null
    const altMobile = allNumbers[1] ?? null
    const contactRaw = rawCellText(contactCell) ?? rawCellText(altCell)

    if (contactIndex !== null) {
      const unreadable = fromContact.reason ?? fromAlt.reason
      if (primaryMobile === null && unreadable) {
        familyWarnings.push({
          code: 'mobile_unreadable',
          severity: 'warning',
          familyNumber,
          sheetRowNumber: row.sheetRowNumber,
          field: headers[contactIndex] ?? 'Contact',
          rawValue: contactRaw,
          action: `Left blank rather than guessed — the number ${unreadable}. This guest cannot be dialled until it is fixed.`,
        })
      } else if (primaryMobile === null) {
        familyWarnings.push({
          code: 'mobile_missing',
          severity: 'warning',
          familyNumber,
          sheetRowNumber: row.sheetRowNumber,
          field: headers[contactIndex] ?? 'Contact',
          rawValue: null,
          action: 'Imported with no phone number — this guest cannot be dialled.',
        })
      }
    }

    const cityRaw = cityIndex === null ? null : cells[cityIndex] ?? null
    const place = normaliseText(cityRaw)
    const headName = name.value

    // Headcount: an explicit total wins; otherwise Adult + Kids.
    const paxRaw = paxIndex != null ? cells[paxIndex] : null
    let expectedPax: number | null = isBlankCell(paxRaw) ? null : parsePax(paxRaw)
    if (expectedPax === null && (adultsIndex != null || kidsIndex != null)) {
      const adults = adultsIndex != null && !isBlankCell(cells[adultsIndex]) ? parsePax(cells[adultsIndex]) : null
      const kids = kidsIndex != null && !isBlankCell(cells[kidsIndex]) ? parsePax(cells[kidsIndex]) : null
      if (adults !== null || kids !== null) expectedPax = (adults ?? 0) + (kids ?? 0)
    }
    if (expectedPax === null) {
      if (hasHeadcount && headName !== null) {
        familyWarnings.push({
          code: 'pax_missing',
          severity: 'warning',
          familyNumber,
          sheetRowNumber: row.sheetRowNumber,
          field: 'Pax',
          rawValue: null,
          action: 'Headcount left blank in the sheet — set to 1. Confirm it on the call.',
        })
      }
      expectedPax = 1
    }

    // Remarks the caller sees: relation, the Remarks cell, and Excel cell
    // notes ("Call Both", "Call Via Botim"). A note on a phone cell names
    // whose number it is, so it keeps that column's header as a label.
    const remarkParts: string[] = []
    const relation = cellText(cells, relationIndex)
    if (relation) remarkParts.push(`Relation: ${relation}`)
    const remarkCell = cellText(cells, remarksIndex)
    if (remarkCell) remarkParts.push(remarkCell)
    for (const note of rowComments?.[row.sheetRowNumber - 1] ?? []) {
      const label = note.col === nameIndex ? null : normaliseText(headers[note.col] ?? null)
      const text = label ? `${label}: ${note.text}` : note.text
      const seen = remarkParts.some((p) => p.toLowerCase().includes(note.text.toLowerCase()))
      if (!seen) remarkParts.push(text)
    }
    const remark = remarkParts.length > 0 ? remarkParts.join(' · ') : null

    const roomRaw = roomIndex != null ? cells[roomIndex] : null
    const room = normaliseText(roomRaw)
    const extras: RowExtras = { id: null, room, bed: null }

    const sectionNow = section as { side: NormalisedSide | null; subSide: SubSide | null } | null
    const resolvedSide = resolveImportedSide(
      sideIndex != null ? cells[sideIndex] : null,
      subSideIndex != null ? cells[subSideIndex] : null,
      sectionNow?.side ?? options.defaultSide,
      sectionNow?.subSide ?? options.defaultSubSide,
    )

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
      familyIndex: familyCount,
      sourceRowIndex: row.sheetRowNumber,
      sheetRowNumbers: [row.sheetRowNumber],
      hash: rowHash({ headName: headName ?? '', groupCode: familyNumber, primaryMobile }),
      headName,
      headNameRaw,
      place,
      side: resolvedSide.side,
      subSide: resolvedSide.subSide,
      primaryMobile,
      primaryMobileRaw: contactRaw,
      altMobile,
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

  if (sectionsSeen.length > 0) {
    notes.push({
      column: 'subSide',
      label: 'Sections',
      detail: `${sectionsSeen.join(', ')} read as headings, not guests — each sets the side of the rows under it.`,
    })
  }
  if (totalsSkipped.length > 0) {
    notes.push({
      column: 'pax',
      label: 'Totals rows',
      detail: `row${totalsSkipped.length === 1 ? '' : 's'} ${totalsSkipped.join(', ')} skipped — they are sums, not families.`,
    })
  }

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
        sheetRows: rows.length - sectionsSeen.length - totalsSkipped.length,
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
    sideIndex?: number | null
    subSideIndex?: number | null
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
    sideIndex: mapping.sideIndex ?? null,
    subSideIndex: mapping.subSideIndex ?? null,
    rows,
  }

  return parseContactsSheet(sheet, options)
}

export { KNOWN_SHEET_NAME, SheetNotFoundError } from './parse'
