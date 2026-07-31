/**
 * Turns a raw sheet row + confirmed column mapping into the structured shape
 * both the preview screen and the commit server action work with.
 *
 * Pure and framework-agnostic - runs in the browser to build the preview,
 * and the exact same field values are what get sent to the server action
 * (which re-derives the hash itself rather than trusting a client-supplied
 * one; see hash.ts).
 */

import { rowHash } from './hash'
import type { ColumnMapping } from './mapper'
import type { RawSheetRow } from './parse'
import {
  normaliseBoolean,
  normaliseGroupType,
  normaliseMobile,
  normaliseSide,
  normaliseText,
  parsePax,
  rsvpFromRemarks,
  type NormalisedGroupType,
  type NormalisedSide,
  type RemarksRsvpHint,
} from './normalize'

export interface ImportRowFields {
  headName: string | null
  groupCode: string | null
  primaryMobile: string | null
  altMobile: string | null
  expectedPax: number | null
  side: NormalisedSide | null
  groupType: NormalisedGroupType | null
  city: string | null
  remarks: string | null
  needsReturnGift: boolean | null
}

export interface BuiltRow {
  rowNumber: number
  raw: Record<string, unknown>
  hash: string
  fields: ImportRowFields
  remarksRsvpHint: RemarksRsvpHint
  warnings: string[]
  canImport: boolean
  blockReason: string | null
}

function cellAt(cells: unknown[], mapping: ColumnMapping, key: keyof ColumnMapping): unknown {
  const idx = mapping[key]
  return typeof idx === 'number' ? (cells[idx] ?? null) : null
}

export function buildRow(
  row: RawSheetRow,
  headers: (string | null)[],
  mapping: ColumnMapping,
): BuiltRow {
  const warnings: string[] = []

  const headNameCell = cellAt(row.cells, mapping, 'head_name')
  const headName = normaliseText(headNameCell)

  const primaryMobileCell = cellAt(row.cells, mapping, 'primary_mobile')
  const primaryMobileResult = normaliseMobile(primaryMobileCell)
  if (primaryMobileResult.reason) {
    warnings.push(`Primary mobile ${primaryMobileResult.reason}.`)
  }

  const altMobileCell = cellAt(row.cells, mapping, 'alt_mobile')
  const altMobileResult = normaliseMobile(altMobileCell)
  if (altMobileResult.reason) {
    warnings.push(`Alt mobile ${altMobileResult.reason}.`)
  }

  const paxCell = cellAt(row.cells, mapping, 'expected_pax')
  const expectedPax = parsePax(paxCell)
  if (!isBlank(paxCell) && expectedPax === null) {
    warnings.push(`Expected pax "${String(paxCell)}" could not be read as a number.`)
  }

  const remarks = normaliseText(cellAt(row.cells, mapping, 'remarks'))
  const remarksRsvpHint = rsvpFromRemarks(remarks)
  if (remarksRsvpHint) {
    warnings.push(
      remarksRsvpHint === 'declined'
        ? 'Remarks look like a decline - RSVP still starts as not_started; review by phone as usual.'
        : 'Remarks look uncertain ("not sure") - RSVP still starts as not_started; review by phone as usual.',
    )
  }

  const groupCode = normaliseText(cellAt(row.cells, mapping, 'group_code'))
  const side = normaliseSide(cellAt(row.cells, mapping, 'side'))
  const groupType = normaliseGroupType(cellAt(row.cells, mapping, 'group_type'))
  const city = normaliseText(cellAt(row.cells, mapping, 'city'))
  const needsReturnGift = normaliseBoolean(cellAt(row.cells, mapping, 'needs_return_gift'))

  const canImport = Boolean(headName)
  const blockReason = canImport
    ? null
    : 'Head / family name is required and is blank on this row.'

  const raw: Record<string, unknown> = {}
  headers.forEach((h, i) => {
    raw[h ?? `column_${i + 1}`] = row.cells[i] ?? null
  })

  const fields: ImportRowFields = {
    headName,
    groupCode,
    primaryMobile: primaryMobileResult.value,
    altMobile: altMobileResult.value,
    expectedPax,
    side,
    groupType,
    city,
    remarks,
    needsReturnGift,
  }

  const hash = rowHash({
    headName: headName ?? '',
    groupCode,
    primaryMobile: fields.primaryMobile,
  })

  return {
    rowNumber: row.sheetRowNumber,
    raw,
    hash,
    fields,
    remarksRsvpHint,
    warnings,
    canImport,
    blockReason,
  }
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === ''
}

/**
 * Shape sent to the `previewImport` / `commitImport` server actions.
 * Structurally identical to `ImportRowInput` in `@/lib/actions/import` -
 * kept as a plain return type here (rather than importing that type) so
 * this module never depends on server-action code.
 */
export function toImportRowInput(row: BuiltRow): {
  rowNumber: number
  raw: Record<string, unknown>
  canImport: boolean
  blockReason: string | null
} & ImportRowFields {
  return {
    rowNumber: row.rowNumber,
    raw: row.raw,
    canImport: row.canImport,
    blockReason: row.blockReason,
    ...row.fields,
  }
}
