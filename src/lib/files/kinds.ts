/**
 * The export kinds the Files area offers, as a plain module.
 *
 * NOT in the `'use server'` action file: a `'use server'` module may only
 * export async functions. Kept here so the Files page and the action share one
 * list of what can be generated and which workbook sheets each kind contains.
 */

export type ExportKind =
  | 'guest_list'
  | 'rsvp_status'
  | 'rooming_list'
  | 'hampers'
  | 'arrivals'
  | 'departures'
  | 'full_backup'

export interface ExportKindSpec {
  id: ExportKind
  label: string
  /** Workbook sheet names this kind writes, in order. */
  sheets: readonly string[]
}

/** Sheet names as `buildSheetDefinitions` names them (src/lib/export/definitions.ts). */
export const ALL_SHEETS = [
  'Guest Master',
  'Family Heads',
  'Room Allocation',
  'Deliverables',
  'Exceptions',
  'RSVP Call Log',
  'Arrivals',
  'Departures',
] as const

export const EXPORT_KINDS: readonly ExportKindSpec[] = [
  { id: 'guest_list', label: 'Guest list', sheets: ['Guest Master', 'Family Heads'] },
  { id: 'rsvp_status', label: 'RSVP status', sheets: ['Family Heads', 'RSVP Call Log'] },
  { id: 'rooming_list', label: 'Rooming list', sheets: ['Room Allocation'] },
  { id: 'hampers', label: 'Hampers', sheets: ['Deliverables'] },
  { id: 'arrivals', label: 'Arrivals', sheets: ['Arrivals'] },
  { id: 'departures', label: 'Departures', sheets: ['Departures'] },
  { id: 'full_backup', label: 'Full event backup', sheets: ALL_SHEETS },
]

export function exportKindSpec(kind: string): ExportKindSpec | null {
  return EXPORT_KINDS.find((k) => k.id === kind) ?? null
}

export function isExportKind(value: string): value is ExportKind {
  return EXPORT_KINDS.some((k) => k.id === value)
}

/** The file extension and content type for a format. */
export function formatMeta(format: 'xlsx' | 'csv'): { ext: string; contentType: string } {
  return format === 'csv'
    ? { ext: 'csv', contentType: 'text/csv' }
    : { ext: 'xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
}
