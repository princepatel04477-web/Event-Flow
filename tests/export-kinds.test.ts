import { describe, expect, it } from 'vitest'

import {
  ALL_SHEETS,
  EXPORT_KINDS,
  exportKindSpec,
  formatMeta,
  isExportKind,
} from '@/lib/files/kinds'

/**
 * The Files area's kind table (A11).
 *
 * WHY THIS FILE EXISTS. The mapping from an export kind to the workbook sheets
 * it writes is the one place a typo hides: a sheet name that no longer exists
 * in `buildSheetDefinitions` makes "Generate" produce an EMPTY workbook, which
 * reads as a data problem rather than a naming one.
 */
describe('export kinds', () => {
  it('names only real workbook sheets', () => {
    const known = new Set<string>(ALL_SHEETS)
    for (const kind of EXPORT_KINDS) {
      expect(kind.sheets.length, kind.id).toBeGreaterThan(0)
      for (const sheet of kind.sheets) {
        expect(known.has(sheet), `${kind.id} -> ${sheet}`).toBe(true)
      }
    }
  })

  it('has a unique id per kind', () => {
    const ids = EXPORT_KINDS.map((k) => k.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('guards unknown values', () => {
    expect(isExportKind('full_backup')).toBe(true)
    expect(isExportKind('not_a_kind')).toBe(false)
    expect(exportKindSpec('full_backup')?.sheets.length).toBe(ALL_SHEETS.length)
    expect(exportKindSpec('not_a_kind')).toBeNull()
  })

  it('maps a format to its extension and content type', () => {
    expect(formatMeta('xlsx').ext).toBe('xlsx')
    expect(formatMeta('csv').ext).toBe('csv')
    expect(formatMeta('csv').contentType).toBe('text/csv')
    expect(formatMeta('xlsx').contentType).toContain('spreadsheetml')
  })
})
