import { createClient } from '@/lib/supabase/server'
import { formatMeta, type ExportKind } from '@/lib/files/kinds'

/**
 * Where generated exports are stored, behind an interface (A11).
 *
 * WHY AN INTERFACE. Supabase Storage is today's backing store and R2 is a
 * change of backing store, not a change of feature — so the callers
 * (`src/lib/actions/files.ts`) depend on `StorageAdapter`, and swapping in an R2
 * implementation later touches this file and nothing else.
 *
 * Uploads run as the signed-in user: the bucket is private and its objects
 * policies fence every path by the event id in the first folder
 * (`<event_id>/...`), which `app.is_staff` checks. Nothing here uses the
 * service role.
 */

export const EXPORTS_BUCKET = 'eventflow-exports'

/** One hour, per the brief: long enough to download, short enough to expire. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60

export type StorageResult = { ok: true } | { ok: false; error: string }

export interface StorageAdapter {
  put(path: string, bytes: Uint8Array, contentType: string): Promise<StorageResult>
  /** A time-limited URL, or null when it could not be signed. */
  signedUrl(path: string, expiresInSeconds: number): Promise<string | null>
}

class SupabaseStorageAdapter implements StorageAdapter {
  async put(path: string, bytes: Uint8Array, contentType: string): Promise<StorageResult> {
    const supabase = await createClient()
    const { error } = await supabase.storage
      .from(EXPORTS_BUCKET)
      .upload(path, bytes, { contentType, upsert: true })
    return error ? { ok: false, error: error.message } : { ok: true }
  }

  async signedUrl(path: string, expiresInSeconds: number): Promise<string | null> {
    const supabase = await createClient()
    const { data } = await supabase.storage
      .from(EXPORTS_BUCKET)
      .createSignedUrl(path, expiresInSeconds)
    return data?.signedUrl ?? null
  }
}

/** The adapter the app uses. One line to change when R2 arrives. */
export function storageAdapter(): StorageAdapter {
  return new SupabaseStorageAdapter()
}

/**
 * Object key: `<event_id>/<kind>-<stamp>.<ext>`.
 *
 * The event id is the FIRST folder on purpose — the storage policies read it
 * from `(storage.foldername(name))[1]` to decide access.
 */
export function exportObjectPath(
  eventId: string,
  kind: ExportKind,
  format: 'xlsx' | 'csv',
  stamp: string,
): string {
  return `${eventId}/${kind}-${stamp}.${formatMeta(format).ext}`
}
