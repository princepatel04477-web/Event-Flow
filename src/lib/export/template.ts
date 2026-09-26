/**
 * The import template, generated from the EXPORT's own sheet definitions.
 *
 * A template built from anything other than the exporter drifts from it, and
 * the drift surfaces as a failed import for the person who trusted it. So this
 * is not a second header list to keep in sync: it is `buildWorkbook` over
 * `buildSheetDefinitions`, with no rows. Whatever the export writes for its
 * headers is, by construction, what this template offers — and therefore what
 * the importer accepts (src/lib/import/knownSheet.ts now finds the calling-list
 * layout on whichever tab carries it, including the export's "Guest Master").
 *
 * Client-safe and pure: no Supabase, no DOM. The legacy import asset
 * (`/nuvent-guest-list-template.xlsx`) is left untouched — it is a frozen
 * identifier and still describes the old calling-list shape.
 */
import type * as XLSX from 'xlsx'

import { buildSheetDefinitions } from './definitions'
import type { ExportData } from './sheets'
import { buildWorkbook } from './workbook'

/** An export with no rows: every sheet present, headers only. */
export function emptyExportData(): ExportData {
  return {
    groups: [],
    guests: [],
    legs: [],
    deliverables: [],
    proofs: [],
    assignments: [],
    rooms: [],
    hotels: [],
    callAttempts: [],
    extractions: [],
    profileNames: {},
    staffNames: {},
  }
}

/**
 * The blank workbook a user fills in to be sure of a clean import: the export
 * format, headers only. The "Export Excel" button and this button produce the
 * same shape, which is the whole point — the file the app writes is the file
 * the app reads.
 */
export function buildExportTemplateWorkbook(): XLSX.WorkBook {
  return buildWorkbook(buildSheetDefinitions(emptyExportData()))
}