'use client'

import type { AnySheetDefinition } from './workbook'

/**
 * Client-side workbook downloads, with `xlsx` loaded ONLY on the tap.
 *
 * WHY THIS MODULE EXISTS. Seven client screens imported `xlsx` (and,
 * transitively, `./workbook`, which also imports it) at module scope, which put
 * the whole library — two chunks of ~460 KB raw between them — into the first
 * load of every route that offers an export. It is needed the instant someone
 * taps Export and never before, so the import belongs inside the handler.
 *
 * A per-screen `await import('xlsx')` was NOT enough on its own: the export
 * screens also import `buildWorkbook` from `./workbook`, which imports `xlsx`
 * statically, so the chunk stayed. This module owns BOTH dynamic imports, so a
 * screen only imports a tiny async function.
 *
 * The output is unchanged — same builders, same `XLSX.writeFile`, just later.
 */

/** Build a multi-sheet workbook from declarative definitions and save it. */
export async function downloadWorkbook(
  sheets: readonly AnySheetDefinition[],
  filename: string,
): Promise<void> {
  const [{ buildWorkbook }, XLSX] = await Promise.all([import('./workbook'), import('xlsx')])
  XLSX.writeFile(buildWorkbook(sheets), filename)
}

/** Build a one-sheet workbook from plain JSON rows and save it. */
export async function downloadJsonSheet(
  rows: readonly Record<string, unknown>[],
  sheetName: string,
  filename: string,
  columnWidths?: readonly number[],
): Promise<void> {
  const XLSX = await import('xlsx')
  const ws = XLSX.utils.json_to_sheet([...rows])
  if (columnWidths) ws['!cols'] = columnWidths.map((wch) => ({ wch }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  XLSX.writeFile(wb, filename)
}

/** The blank import template — the export's own shape, headers only. */
export async function downloadTemplate(filename: string): Promise<void> {
  const [{ buildExportTemplateWorkbook }, XLSX] = await Promise.all([
    import('./template'),
    import('xlsx'),
  ])
  XLSX.writeFile(buildExportTemplateWorkbook(), filename)
}
