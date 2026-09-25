'use server'

import { revalidatePath } from 'next/cache'
import * as XLSX from 'xlsx'

import { readExportData } from '@/lib/actions/export'
import { buildSheetDefinitions } from '@/lib/export/definitions'
import { buildWorkbook } from '@/lib/export/workbook'
import { exportKindSpec, formatMeta, type ExportKind } from '@/lib/files/kinds'
import { exportObjectPath, SIGNED_URL_TTL_SECONDS, storageAdapter } from '@/lib/files/storage'
import { createClient } from '@/lib/supabase/server'

/**
 * The Files area (A11): generate an export, store it privately, record it, and
 * hand back a one-hour signed URL.
 *
 * The workbook itself is built by the SAME definitions the client export
 * already uses (`buildSheetDefinitions` + `buildWorkbook`), so a generated file
 * is byte-for-byte the same shape as the one the old screen produced — this
 * feature adds storage and history, not a second export format.
 *
 * Access is enforced twice: `readExportData` refuses a non-staff caller, and
 * the storage policies refuse an upload to another event's folder.
 */

export type ExportFormat = 'xlsx' | 'csv'

export type GenerateExportResult =
  | { ok: true; path: string; url: string | null; bytes: number }
  | { ok: false; error: string }

type DbError = { code?: string | null; message?: string | null } | null

type ExportFilesClient = {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> }
  from: (table: string) => {
    insert: (values: Record<string, unknown>) => Promise<{ error: DbError }>
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        order: (
          column: string,
          options: { ascending: boolean },
        ) => Promise<{ data: Array<Record<string, unknown>> | null }>
      }
    }
  }
}

export async function generateExport(
  eventId: string,
  kind: ExportKind,
  format: ExportFormat,
): Promise<GenerateExportResult> {
  const spec = exportKindSpec(kind)
  if (!spec) return { ok: false, error: 'Unknown export.' }

  const source = await readExportData(eventId)
  if (!source.ok) return { ok: false, error: source.message }

  const sheets = buildSheetDefinitions(source.data).filter((sheet) =>
    spec.sheets.includes(sheet.name),
  )
  if (sheets.length === 0) return { ok: false, error: 'There is nothing to export yet.' }

  const workbook = buildWorkbook(sheets)
  const bytes =
    format === 'csv'
      ? Buffer.from(XLSX.write(workbook, { type: 'string', bookType: 'csv' }), 'utf8')
      : (XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer)

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const path = exportObjectPath(eventId, kind, format, stamp)

  const adapter = storageAdapter()
  const put = await adapter.put(path, new Uint8Array(bytes), formatMeta(format).contentType)
  if (!put.ok) return { ok: false, error: `Could not store the file: ${put.error}` }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { error } = await (supabase as unknown as ExportFilesClient)
    .from('export_files')
    .insert({
      event_id: eventId,
      kind,
      format,
      path,
      bytes: bytes.length,
      created_by: user?.id ?? null,
    })

  revalidatePath('/', 'layout')

  const url = await adapter.signedUrl(path, SIGNED_URL_TTL_SECONDS)
  return { ok: true, path, url, bytes: bytes.length }
}

export interface ExportFileRow {
  id: string
  kind: string
  format: string
  bytes: number
  createdAt: string
  path: string
}

/** The history, newest first. An unreadable table reads as empty. */
export async function listExports(eventId: string): Promise<ExportFileRow[]> {
  try {
    const supabase = await createClient()
    const { data } = await (supabase as unknown as ExportFilesClient)
      .from('export_files')
      .select('id, kind, format, bytes, created_at, path')
      .eq('event_id', eventId)
      .order('created_at', { ascending: false })

    return (data ?? []).map((row) => ({
      id: String(row.id),
      kind: String(row.kind),
      format: String(row.format),
      bytes: typeof row.bytes === 'number' ? row.bytes : 0,
      createdAt: String(row.created_at),
      path: String(row.path),
    }))
  } catch {
    return []
  }
}

/**
 * A fresh one-hour URL for a stored file.
 *
 * No ownership check in TypeScript on purpose: `createSignedUrl` only succeeds
 * when the caller's storage policies allow reading the object, and those fence
 * by the event id in the path — so an outsider cannot sign another event's file
 * by guessing the path.
 */
export async function signExport(path: string): Promise<string | null> {
  return storageAdapter().signedUrl(path, SIGNED_URL_TTL_SECONDS)
}
