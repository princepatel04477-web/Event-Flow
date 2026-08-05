/**
 * Family grouping for the known CALLING_MASTER_LIST layout.
 *
 * THE ONE THING THIS MODULE CHANGES: the older path modelled one sheet row as
 * one family and produced exactly one guest — the head. This sheet does not
 * work that way. A family occupies as many consecutive rows as it has people:
 * the first row carries the family number in column "U" plus every family-level
 * field, and each row beneath it carries A NAME AND NOTHING ELSE. That is the
 * difference between importing 238 guests and importing 465.
 *
 * ------------------------------------------------------------------------
 * WHY THE "U" RULE SUPERSEDES `forwardFillGroupColumns`, AND WHY THE OLD BUG
 * CANNOT COME BACK
 * ------------------------------------------------------------------------
 * parse.ts documents a rule paid for in blood: a row inherits from the family
 * above ONLY when its own head-name cell is blank, because a family whose
 * phone cell was empty once silently inherited the previous family's number
 * and a caller reached the wrong household.
 *
 * That rule was a heuristic for a sheet where nothing marked a family
 * boundary. This sheet marks it explicitly, so the boundary is read rather
 * than inferred — and the new rule is strictly stronger:
 *
 *   - A family starts if and only if column "U" is filled. Nothing else can
 *     start one.
 *   - Family-level fields (PLACE, CONTACT, Pax, travel, Remark) are read from
 *     that first row ONLY. They are never copied down, never copied across,
 *     and no continuation row can contribute one.
 *   - Continuation rows become MEMBERS of the family above. A member has a
 *     name and a row number. It has no phone number of its own, so there is
 *     no field into which a neighbouring family's number could leak.
 *   - A blank-"U" row that does not continue the sequence becomes an ORPHAN.
 *     It is reported with its raw cells and is attached to nothing.
 *
 * The old failure needed a row to become a SEPARATE FAMILY while inheriting a
 * NEIGHBOUR'S CONTACT CELL. Under these rules a row can only become a family
 * by carrying its own "U", and a family only ever reads CONTACT from its own
 * first row. Neither half of the failure is reachable. `forwardFillGroupColumns`
 * is untouched and still guards the manual-mapping fallback path, where a
 * sheet has no "U" column and the heuristic is still the best available.
 *
 * Pure: no React, no Supabase, no DOM, no clock. The browser preview and the
 * server-side commit run this same function over the same payload and must
 * produce identical output.
 */

import {
  buildDateWindow,
  cleanPersonName,
  isBlankCell,
  parseEventDate,
  parseSerialNumber,
  parseSheetTime,
  parseTravelMode,
  rawCellText,
  rawRecord,
  type DateWindow,
  type TravelMode,
} from './cells'
import { rowHash } from './hash'
import type { KnownLayout } from './layout'
import { importRsvpStatus, normaliseMobile, normaliseText, parsePax, type ImportRsvpStatus } from './normalize'
import type { RawSheetRow } from './parse'

// ---------------------------------------------------------------------------
// warnings
// ---------------------------------------------------------------------------

export type ImportWarningCode =
  | 'head_name_missing'
  | 'member_name_missing'
  | 'mobile_unreadable'
  | 'mobile_missing'
  | 'pax_unreadable'
  | 'pax_missing'
  | 'pax_member_mismatch'
  | 'date_unresolved'
  | 'time_unresolved'
  | 'mode_unrecognised'
  | 'rsvp_from_remark'
  | 'family_number_duplicate'
  | 'family_number_missing_sr_no'
  | 'orphan_row'
  | 'nickname_removed'

export type ImportWarningSeverity = 'info' | 'warning' | 'critical'

/**
 * A structured warning, never a string — the preview screen groups and counts
 * these, and a human has to be able to find the offending cell in Excel and
 * fix it. Hence: which family, which row, which column, what the cell
 * actually said, and what the parser did about it.
 */
export interface ImportWarning {
  code: ImportWarningCode
  severity: ImportWarningSeverity
  /** The "U" value of the family this belongs to, or null for an orphan. */
  familyNumber: string | null
  /** 1-based row number as Excel shows it. */
  sheetRowNumber: number
  /** The column header, exactly as it reads in the sheet. */
  field: string
  /** The cell verbatim. */
  rawValue: string | null
  /** What the parser did — always phrased as an action already taken. */
  action: string
}

export const WARNING_LABELS: Record<ImportWarningCode, string> = {
  head_name_missing: 'Family has no name',
  member_name_missing: 'Member row has no name',
  mobile_unreadable: 'Phone number could not be read',
  mobile_missing: 'No phone number',
  pax_unreadable: 'Pax could not be read',
  pax_missing: 'No pax',
  pax_member_mismatch: 'Pax does not match the number of names',
  date_unresolved: 'Date kept as raw text',
  time_unresolved: 'Time could not be read',
  mode_unrecognised: 'Travel mode not recognised',
  rsvp_from_remark: 'RSVP taken from the Remark column',
  family_number_duplicate: 'Family number used twice',
  family_number_missing_sr_no: 'Family has no SR.NO',
  orphan_row: 'Row does not belong to any family',
  nickname_removed: 'Nickname removed from a name',
}

export interface WarningGroup {
  code: ImportWarningCode
  label: string
  severity: ImportWarningSeverity
  count: number
  warnings: ImportWarning[]
}

/** Groups warnings by code, most severe and most numerous first. */
export function groupWarnings(warnings: ImportWarning[]): WarningGroup[] {
  const order: Record<ImportWarningSeverity, number> = { critical: 0, warning: 1, info: 2 }
  const byCode = new Map<ImportWarningCode, ImportWarning[]>()

  for (const w of warnings) {
    const list = byCode.get(w.code)
    if (list) list.push(w)
    else byCode.set(w.code, [w])
  }

  return [...byCode.entries()]
    .map(([code, list]) => ({
      code,
      label: WARNING_LABELS[code],
      severity: list[0].severity,
      count: list.length,
      warnings: list,
    }))
    .sort((a, b) => order[a.severity] - order[b.severity] || b.count - a.count)
}

// ---------------------------------------------------------------------------
// parsed shapes
// ---------------------------------------------------------------------------

/** Columns captured verbatim for Phase 2 (rooms). Not modelled, just kept. */
export interface RowExtras {
  /** The `ID` column. */
  id: string | null
  /** The `Romm` column, spelling and all. */
  room: string | null
  /** The `bed` column. */
  bed: string | null
}

export interface ParsedMember {
  /** Display name, nickname stripped, original casing preserved. */
  fullName: string
  /** The name cell verbatim, before cleaning. */
  rawName: string | null
  /** 1-based row number as Excel shows it. */
  sourceRowIndex: number
  /** True for the family's first row. At most one per family. */
  isHead: boolean
  /** SR.NO as read, for tracing a member back to the sheet. */
  serialNumber: number | null
  extras: RowExtras
  raw: Record<string, unknown>
}

export interface ParsedTravelLeg {
  direction: 'arrival' | 'departure'
  /** ISO `YYYY-MM-DD` for `travel_legs.travel_date`, or null. */
  travelDate: string | null
  /** The date cell verbatim — kept whenever `travelDate` is null. */
  travelDateRaw: string | null
  /** "HH:MM" 24-hour for `travel_legs.travel_time`, or null. */
  travelTime: string | null
  travelTimeRaw: string | null
  mode: TravelMode | null
  modeRaw: string | null
  /** The `Details` column -> `travel_legs.reference` (flight no / train no). */
  reference: string | null
  /** `Pick up` / `Drop` -> `travel_legs.point`. */
  point: string | null
  /** False when every cell of this leg was blank — nothing to write. */
  hasAnyValue: boolean
}

export interface ParsedFamily {
  /** The "U" cell — the family number, as text. */
  familyNumber: string
  /** 1-based position of this family within the sheet. */
  familyIndex: number
  /** 1-based row number of the family's FIRST row, as Excel shows it. */
  sourceRowIndex: number
  /** Every sheet row this family occupies, head row first. */
  sheetRowNumbers: number[]
  /** Idempotency key — same shape `guest_groups.source_row_hash` already uses. */
  hash: string

  headName: string | null
  headNameRaw: string | null
  /** `PLACE` -> `guest_groups.city`. */
  place: string | null
  /** 10 digits, or null. Never a truncated guess. */
  primaryMobile: string | null
  primaryMobileRaw: string | null
  /** The `Pax` cell. Null means "the sheet did not say" — never assumed. */
  expectedPax: number | null
  /** How many names this family actually lists. */
  memberCount: number
  /** The `Remark` cell, verbatim. */
  remark: string | null
  /** Only ever not_started / declined / tentative. Never confirmed. */
  rsvpStatus: ImportRsvpStatus

  arrival: ParsedTravelLeg
  departure: ParsedTravelLeg

  members: ParsedMember[]
  extras: RowExtras
  /** The head row's cells, keyed by header. The permanent record. */
  raw: Record<string, unknown>

  warnings: ImportWarning[]
  /** False when `guest_groups` could not accept this family (head_name is NOT NULL). */
  canImport: boolean
  blockReason: string | null
}

export interface OrphanRow {
  /** 1-based row number as Excel shows it. */
  sheetRowNumber: number
  /** Raw cells, exactly as read. */
  cells: unknown[]
  /** The same cells keyed by header. */
  raw: Record<string, unknown>
  /** The name on the row, if any — usually the only thing on it. */
  name: string | null
  uRaw: string | null
  srNoRaw: string | null
  /** Which family it would have joined, had the sequence held. */
  precedingFamilyNumber: string | null
  reason: string
}

export interface ParsedFamilySheetCounts {
  /** Non-blank data rows below the header. */
  sheetRows: number
  blankRowsSkipped: number
  families: number
  members: number
  orphans: number
  warnings: number
  criticalWarnings: number
  blockedFamilies: number
}

export interface ParsedFamilySheet {
  families: ParsedFamily[]
  orphans: OrphanRow[]
  /** Every warning from every family plus the orphans, in sheet order. */
  warnings: ImportWarning[]
  counts: ParsedFamilySheetCounts
  /** The date window ordinals were resolved against, for the preview header. */
  dateWindow: DateWindow
}

export interface ParseFamiliesInput {
  headers: (string | null)[]
  rows: RawSheetRow[]
  blankRowsSkipped?: number
}

export interface ParseFamiliesOptions {
  /**
   * `events.starts_on`. Both event dates are nullable in the schema, so both
   * are optional here. Passed IN rather than read from the database, so this
   * module stays pure and the preview and the commit cannot disagree.
   */
  eventStartsOn: string | null
  /** `events.ends_on`. */
  eventEndsOn: string | null
}

// ---------------------------------------------------------------------------
// parsing
// ---------------------------------------------------------------------------

function cellAt(cells: unknown[], index: number | null): unknown {
  if (index === null) return null
  return cells[index] ?? null
}

function extrasFrom(cells: unknown[], layout: KnownLayout): RowExtras {
  return {
    id: rawCellText(cellAt(cells, layout.id)),
    room: rawCellText(cellAt(cells, layout.room)),
    bed: rawCellText(cellAt(cells, layout.bed)),
  }
}

const LEG_FIELDS = {
  arrival: {
    date: 'Arrival Date',
    time: 'Time (arrival)',
    mode: 'Mode (arrival)',
    details: 'Details (arrival)',
    point: 'Pick up',
  },
  departure: {
    date: 'Departure Date',
    time: 'Time (departure)',
    mode: 'Mode (departure)',
    details: 'Details (departure)',
    point: 'Drop',
  },
} as const

function buildLeg(
  direction: 'arrival' | 'departure',
  cells: unknown[],
  layout: KnownLayout,
  window: DateWindow,
  push: (w: Omit<ImportWarning, 'familyNumber' | 'sheetRowNumber'>) => void,
): ParsedTravelLeg {
  const cols =
    direction === 'arrival'
      ? {
          date: layout.arrivalDate,
          time: layout.arrivalTime,
          mode: layout.arrivalMode,
          details: layout.arrivalDetails,
          point: layout.pickUp,
        }
      : {
          date: layout.departureDate,
          time: layout.departureTime,
          mode: layout.departureMode,
          details: layout.departureDetails,
          point: layout.drop,
        }

  const labels = LEG_FIELDS[direction]

  const date = parseEventDate(cells[cols.date] ?? null, window)
  if (date.reason) {
    push({
      code: 'date_unresolved',
      severity: 'warning',
      field: labels.date,
      rawValue: date.rawText,
      action: `Left blank on the travel leg: ${date.reason}.`,
    })
  }

  const time = parseSheetTime(cells[cols.time] ?? null)
  if (time.reason) {
    push({
      code: 'time_unresolved',
      severity: 'warning',
      field: labels.time,
      rawValue: time.rawText,
      action: `Left blank on the travel leg: ${time.reason}.`,
    })
  }

  const mode = parseTravelMode(cells[cols.mode] ?? null)
  if (mode.reason) {
    push({
      code: 'mode_unrecognised',
      severity: 'warning',
      field: labels.mode,
      rawValue: mode.rawText,
      action: `Left blank on the travel leg: ${mode.reason}.`,
    })
  }

  const reference = normaliseText(cells[cols.details] ?? null)
  const point = normaliseText(cells[cols.point] ?? null)

  return {
    direction,
    travelDate: date.value,
    travelDateRaw: date.rawText,
    travelTime: time.value,
    travelTimeRaw: time.rawText,
    mode: mode.value,
    modeRaw: mode.rawText,
    reference,
    point,
    hasAnyValue: Boolean(
      date.value || date.rawText || time.value || mode.value || mode.rawText || reference || point,
    ),
  }
}

interface OpenFamily {
  family: ParsedFamily
  /** SR.NO of the last row accepted into this family, or null if unknown. */
  lastSerial: number | null
}

/**
 * Groups a known-layout sheet into families with their members.
 *
 * Every row lands in exactly one of four places and nothing is dropped
 * silently: a family head row, a member row, an orphan, or the blank-row
 * count. Callers get the counts back so the preview can assert that
 * families + members + orphans + blanks accounts for the whole file.
 */
export function parseFamilies(
  input: ParseFamiliesInput,
  layout: KnownLayout,
  options: ParseFamiliesOptions,
): ParsedFamilySheet {
  const window = buildDateWindow(options.eventStartsOn, options.eventEndsOn)

  const families: ParsedFamily[] = []
  const orphans: OrphanRow[] = []
  const seenFamilyNumbers = new Map<string, number>()

  let open: OpenFamily | null = null

  for (const row of input.rows) {
    const cells = row.cells
    const uRaw = rawCellText(cellAt(cells, layout.u))
    const serial = parseSerialNumber(cellAt(cells, layout.srNo))
    const name = cleanPersonName(cellAt(cells, layout.name))
    const raw = rawRecord(input.headers, cells)

    // ---- a filled "U" starts a new family. Nothing else can. --------------
    if (uRaw !== null) {
      const familyNumber = uRaw
      const familyIndex = families.length + 1
      const warnings: ImportWarning[] = []

      const push = (w: Omit<ImportWarning, 'familyNumber' | 'sheetRowNumber'>) => {
        warnings.push({ ...w, familyNumber, sheetRowNumber: row.sheetRowNumber })
      }

      const previousIndex = seenFamilyNumbers.get(familyNumber)
      if (previousIndex !== undefined) {
        push({
          code: 'family_number_duplicate',
          severity: 'critical',
          field: 'U',
          rawValue: familyNumber,
          action: `Imported as a separate family — "${familyNumber}" is already used by the family starting at row ${previousIndex}. Check the sheet has not been re-sorted.`,
        })
      }
      seenFamilyNumbers.set(familyNumber, row.sheetRowNumber)

      const headNameRaw = rawCellText(cellAt(cells, layout.name))
      if (name.removed) {
        push({
          code: 'nickname_removed',
          severity: 'info',
          field: 'Name',
          rawValue: headNameRaw,
          action: `Imported as "${name.value}" — the bracketed part ${name.removed} was removed.`,
        })
      }
      if (name.value === null) {
        push({
          code: 'head_name_missing',
          severity: 'critical',
          field: 'Name',
          rawValue: headNameRaw,
          action: 'Nothing was imported for this family — a family must have a name.',
        })
      }

      // CONTACT is read from THIS row and no other. See the module header.
      const contactCell = cellAt(cells, layout.contact)
      const mobile = normaliseMobile(contactCell)
      const contactRaw = rawCellText(contactCell)
      if (mobile.reason) {
        push({
          code: 'mobile_unreadable',
          severity: 'warning',
          field: 'CONTACT',
          rawValue: contactRaw,
          action: `Left blank rather than guessed — the number ${mobile.reason}. This family cannot be dialled until it is fixed.`,
        })
      } else if (mobile.value === null) {
        push({
          code: 'mobile_missing',
          severity: 'warning',
          field: 'CONTACT',
          rawValue: null,
          action: 'Imported with no phone number — this family cannot be dialled.',
        })
      }

      const paxCell = cellAt(cells, layout.pax)
      const expectedPax = parsePax(paxCell)
      if (isBlankCell(paxCell)) {
        push({
          code: 'pax_missing',
          severity: 'warning',
          field: 'Pax',
          rawValue: null,
          action: 'Left unset — the number of names on the sheet is shown instead.',
        })
      } else if (expectedPax === null) {
        push({
          code: 'pax_unreadable',
          severity: 'warning',
          field: 'Pax',
          rawValue: rawCellText(paxCell),
          action: 'Left unset — it could not be read as a number.',
        })
      }

      const remark = normaliseText(cellAt(cells, layout.remark))
      const rsvpStatus = importRsvpStatus(remark)
      if (rsvpStatus !== 'not_started') {
        push({
          code: 'rsvp_from_remark',
          severity: 'warning',
          field: 'Remark',
          rawValue: remark,
          action: `Imported as "${rsvpStatus}" from the remark. Confirmations still only come from a reviewed call.`,
        })
      }

      if (serial === null) {
        push({
          code: 'family_number_missing_sr_no',
          severity: 'warning',
          field: 'SR.NO',
          rawValue: rawCellText(cellAt(cells, layout.srNo)),
          action:
            'Left as-is, but rows below this one cannot be checked for a running SR.NO, so any of them will be reported as orphans rather than guessed into this family.',
        })
      }

      const arrival = buildLeg('arrival', cells, layout, window, push)
      const departure = buildLeg('departure', cells, layout, window, push)

      const extras = extrasFrom(cells, layout)
      const primaryMobile = mobile.value

      const members: ParsedMember[] = []
      if (name.value !== null) {
        members.push({
          fullName: name.value,
          rawName: headNameRaw,
          sourceRowIndex: row.sheetRowNumber,
          isHead: true,
          serialNumber: serial,
          extras,
          raw,
        })
      }

      const family: ParsedFamily = {
        familyNumber,
        familyIndex,
        sourceRowIndex: row.sheetRowNumber,
        sheetRowNumbers: [row.sheetRowNumber],
        hash: rowHash({
          headName: name.value ?? '',
          groupCode: familyNumber,
          primaryMobile,
        }),
        headName: name.value,
        headNameRaw,
        place: normaliseText(cellAt(cells, layout.place)),
        primaryMobile,
        primaryMobileRaw: contactRaw,
        expectedPax,
        memberCount: members.length,
        remark,
        rsvpStatus,
        arrival,
        departure,
        members,
        extras,
        raw,
        warnings,
        canImport: name.value !== null,
        blockReason:
          name.value !== null
            ? null
            : 'This family has no name, and a family cannot be created without one.',
      }

      families.push(family)
      open = { family, lastSerial: serial }
      continue
    }

    // ---- blank "U": a member of the family above, or an orphan ------------
    const addOrphan = (reason: string) => {
      orphans.push({
        sheetRowNumber: row.sheetRowNumber,
        cells,
        raw,
        name: name.value,
        uRaw,
        srNoRaw: rawCellText(cellAt(cells, layout.srNo)),
        precedingFamilyNumber: open?.family.familyNumber ?? null,
        reason,
      })
    }

    if (open === null) {
      addOrphan(
        'It sits above the first family number in the sheet, so there is no family it can belong to.',
      )
      continue
    }

    const expectedSerial = open.lastSerial === null ? null : open.lastSerial + 1

    if (serial === null) {
      addOrphan(
        `Its "U" cell is blank and its SR.NO is blank too, so there is nothing to prove it belongs to family ${open.family.familyNumber}. It was NOT attached — the sheet may have been re-sorted or hand-edited.`,
      )
      continue
    }

    if (expectedSerial === null) {
      addOrphan(
        `Family ${open.family.familyNumber} has no SR.NO on its first row, so this row's SR.NO ${serial} cannot be checked against a running sequence. It was NOT attached.`,
      )
      continue
    }

    if (serial !== expectedSerial) {
      addOrphan(
        `Its SR.NO is ${serial}, but family ${open.family.familyNumber} was up to ${open.lastSerial}, so ${expectedSerial} was expected. It was NOT attached — the sheet may have been re-sorted or hand-edited.`,
      )
      continue
    }

    // A genuine continuation row. It contributes A NAME AND NOTHING ELSE.
    open.lastSerial = serial
    open.family.sheetRowNumbers.push(row.sheetRowNumber)

    const memberNameRaw = rawCellText(cellAt(cells, layout.name))
    if (name.value === null) {
      open.family.warnings.push({
        code: 'member_name_missing',
        severity: 'warning',
        familyNumber: open.family.familyNumber,
        sheetRowNumber: row.sheetRowNumber,
        field: 'Name',
        rawValue: memberNameRaw,
        action: `Skipped — the row continues family ${open.family.familyNumber} but names nobody.`,
      })
      continue
    }

    if (name.removed) {
      open.family.warnings.push({
        code: 'nickname_removed',
        severity: 'info',
        familyNumber: open.family.familyNumber,
        sheetRowNumber: row.sheetRowNumber,
        field: 'Name',
        rawValue: memberNameRaw,
        action: `Imported as "${name.value}" — the bracketed part ${name.removed} was removed.`,
      })
    }

    open.family.members.push({
      fullName: name.value,
      rawName: memberNameRaw,
      sourceRowIndex: row.sheetRowNumber,
      // `guests_single_head_per_group` allows exactly one head per group, and
      // the head row already claimed it.
      isHead: false,
      serialNumber: serial,
      extras: extrasFrom(cells, layout),
      raw,
    })
    open.family.memberCount = open.family.members.length
  }

  // ---- cross-row checks, once every family is complete --------------------
  for (const family of families) {
    if (
      family.expectedPax !== null &&
      family.memberCount > 0 &&
      family.expectedPax !== family.memberCount
    ) {
      family.warnings.push({
        code: 'pax_member_mismatch',
        severity: 'warning',
        familyNumber: family.familyNumber,
        sheetRowNumber: family.sourceRowIndex,
        field: 'Pax',
        rawValue: String(family.expectedPax),
        action: `Kept as ${family.expectedPax}, but ${family.memberCount} name${
          family.memberCount === 1 ? ' is' : 's are'
        } listed. The caller confirms the real number on the phone.`,
      })
    }
  }

  const orphanWarnings: ImportWarning[] = orphans.map((o) => ({
    code: 'orphan_row',
    severity: 'critical',
    familyNumber: null,
    sheetRowNumber: o.sheetRowNumber,
    field: 'U / SR.NO',
    rawValue: o.name ?? o.srNoRaw,
    action: `Not imported. ${o.reason}`,
  }))

  const warnings = [...families.flatMap((f) => f.warnings), ...orphanWarnings].sort(
    (a, b) => a.sheetRowNumber - b.sheetRowNumber,
  )

  return {
    families,
    orphans,
    warnings,
    dateWindow: window,
    counts: {
      sheetRows: input.rows.length,
      blankRowsSkipped: input.blankRowsSkipped ?? 0,
      families: families.length,
      members: families.reduce((n, f) => n + f.members.length, 0),
      orphans: orphans.length,
      warnings: warnings.length,
      criticalWarnings: warnings.filter((w) => w.severity === 'critical').length,
      blockedFamilies: families.filter((f) => !f.canImport).length,
    },
  }
}
