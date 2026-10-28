'use client'

/**
 * Browser-side access to the R2 media store, through `/api/media`.
 *
 * This replaces `supabase.storage.from(bucket).upload(...)` at every call
 * site. The shape is deliberately the same — one call, a blob in, an error
 * string or nothing out — so the three upload paths (voice note, harvested
 * recording, delivery proof) keep their existing retry and outbox logic
 * untouched. Only the destination changed.
 *
 * The request carries the session cookie, and the route re-derives the event
 * id from the key and checks staff access before it writes a byte. Nothing
 * here is trusted; this module only has to be convenient.
 */

export type MediaBucket =
  | 'eventflow-call-recordings'
  | 'eventflow-delivery-proofs'
  | 'eventflow-exports'

export type MediaUploadResult = { ok: true } | { ok: false; error: string }

function endpoint(bucket: MediaBucket, key: string): string {
  return `/api/media?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(key)}`
}

/**
 * A URL the browser can load directly — an `<audio src>` or `<img src>`.
 *
 * There is no signed URL and no expiry to manage: the route authorises every
 * request against the live session instead. That is strictly better than the
 * signed URLs it replaces, which stayed valid for their full TTL even after a
 * code was revoked.
 */
export function mediaUrl(bucket: MediaBucket, key: string): string {
  return endpoint(bucket, key)
}

export async function uploadMedia(input: {
  bucket: MediaBucket
  key: string
  blob: Blob
  contentType: string
}): Promise<MediaUploadResult> {
  let res: Response
  try {
    res = await fetch(endpoint(input.bucket, input.key), {
      method: 'PUT',
      headers: { 'content-type': input.contentType },
      body: input.blob,
    })
  } catch {
    // No signal. The caller's outbox keeps the bytes; say so in its words,
    // not in fetch's.
    return { ok: false, error: 'No connection, so the file could not be sent.' }
  }

  if (res.ok) return { ok: true }

  // The route answers JSON for every refusal, but a Worker-level failure
  // (a 502 from the platform, an HTML error page) would not parse — and
  // throwing here would turn a retryable upload into a crash.
  let message = `Upload failed (${res.status}).`
  try {
    const body = (await res.json()) as { error?: string }
    if (body?.error) message = body.error
  } catch {
    /* keep the status-code message */
  }
  return { ok: false, error: message }
}
