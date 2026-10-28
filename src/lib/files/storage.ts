import { formatMeta, type ExportKind } from '@/lib/files/kinds'
import { mediaBucket } from '@/lib/media/r2'

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

/**
 * The Supabase adapter that used to live here is gone, not commented out.
 * Exports are regenerated on demand and the two files that older
 * `export_files` rows point at were copied into R2, so there is no path left
 * that needs to read the old bucket — and a dead adapter kept "just in case"
 * is how two stores quietly become permanent.
 *
 * Recordings and proofs are the opposite case and DO keep both branches
 * forever: their rows carry `storage_bucket` and cannot be updated. See
 * `src/lib/media/names.ts`.
 */

/**
 * R2, through the same interface. The comment above the Supabase adapter
 * predicted this would touch "this file and nothing else", and it did.
 *
 * `signedUrl` returns a route, not a signed URL — R2 has no signing without
 * S3 credentials, and the route re-authorises against the live session on
 * every request. `expiresInSeconds` is therefore ignored, which is stricter
 * than the thing it replaces rather than looser: a Supabase signed URL stayed
 * valid for its full hour even after the staff member's code was revoked.
 */
class R2StorageAdapter implements StorageAdapter {
  async put(path: string, bytes: Uint8Array, contentType: string): Promise<StorageResult> {
    try {
      const store = await mediaBucket('eventflow-exports')
      await store.put(path, bytes, { httpMetadata: { contentType } })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Could not store the file.' }
    }
  }

  async signedUrl(path: string): Promise<string | null> {
    return `/api/media?bucket=eventflow-exports&key=${encodeURIComponent(path)}`
  }
}

/** The adapter the app uses. */
export function storageAdapter(): StorageAdapter {
  return new R2StorageAdapter()
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
