import { NextResponse, type NextRequest } from 'next/server'

import { getEventAccess } from '@/lib/supabase/queries'
import {
  eventIdFromKey,
  isSafeKey,
  mediaBucket,
  type R2BucketName,
} from '@/lib/media/r2'

/**
 * The media endpoint: every byte into and out of R2 goes through here.
 *
 * WHAT THIS REPLACES, AND WHAT IT COSTS
 *
 * On Supabase Storage the tenancy fence was a bucket POLICY — the object's
 * first path segment was read with `(storage.foldername(name))[1]`, cast to
 * uuid, and checked with `app.is_staff`. A crafted path was rejected by
 * Postgres, so no application bug could widen it.
 *
 * R2 has no equivalent. That check is now `assertStaffOnKey()` below, forty
 * lines of TypeScript, and it is the ONLY thing between one event's
 * recordings and another's. That is a real reduction in guarantee and it is
 * why every path in this file ends in an access check before it touches a
 * bucket — including the one that only reads.
 *
 * WHY A ROUTE HANDLER AND NOT A SERVER ACTION
 *
 * `serverActions.bodySizeLimit` defaults to 1 MB. A wav recording of a
 * four-minute call is ~8 MB. A route handler streams the request body with no
 * such cap, which is the whole reason audio can take this path at all.
 */

export const dynamic = 'force-dynamic'

/** The buckets this endpoint will serve, by their R2 names. */
const ALLOWED: Record<string, R2BucketName> = {
  'eventflow-call-recordings': 'eventflow-call-recordings',
  'eventflow-delivery-proofs': 'eventflow-delivery-proofs',
  'eventflow-exports': 'eventflow-exports',
}

type Denied = { ok: false; response: NextResponse }
type Allowed = { ok: true; bucket: R2BucketName; key: string }

function bad(status: number, message: string): Denied {
  return { ok: false, response: NextResponse.json({ error: message }, { status }) }
}

/**
 * Resolve and authorise one request.
 *
 * Deliberately returns 404 — not 403 — for a key the caller may not touch.
 * A 403 confirms the object exists, which tells someone probing another
 * event's bucket that they found something real.
 */
async function assertStaffOnKey(req: NextRequest): Promise<Allowed | Denied> {
  const params = req.nextUrl.searchParams
  const bucketParam = params.get('bucket') ?? ''
  const key = params.get('key') ?? ''

  const bucket = ALLOWED[bucketParam]
  if (!bucket) return bad(400, 'Unknown bucket.')
  if (!isSafeKey(key)) return bad(400, 'Bad object key.')

  const eventId = eventIdFromKey(key)
  if (!eventId) return bad(400, 'Object key does not start with an event id.')

  const access = await getEventAccess(eventId)
  // A client login is a member of the event but must never reach raw media:
  // recordings are evidence and proofs are operational. Staff only.
  if (access !== 'admin' && access !== 'event_team') {
    return bad(404, 'Not found.')
  }

  return { ok: true, bucket, key }
}

/** 60 MB: a long call as WAV, with room to spare; far below Worker memory. */
const MAX_UPLOAD_BYTES = 60 * 1024 * 1024

/** Upload. The body is the object; the key says where it goes. */
export async function PUT(req: NextRequest) {
  const resolved = await assertStaffOnKey(req)
  if (!resolved.ok) return resolved.response

  const contentType = req.headers.get('content-type') || 'application/octet-stream'
  if (!req.body) return NextResponse.json({ error: 'Empty body.' }, { status: 400 })

  // `upsert` is the caller's business: a retry of a half-finished upload wants
  // the same key overwritten, a new capture never collides because its key
  // carries a uuid. R2 overwrites by default, which is the retry behaviour.
  // Buffer, do not stream. R2's put() refuses a ReadableStream whose length it
  // cannot see ("Provided readable stream must have a known length"), and the
  // body OpenNext hands this route is exactly that — every upload 502'd in
  // production until 12 Nov 2026 with the stream passed straight through.
  // A four-minute call is ~8 MB, far inside the Worker's memory.
  const declared = Number(req.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'File too large.' }, { status: 413 })
  }
  let bytes: ArrayBuffer
  try {
    bytes = await req.arrayBuffer()
  } catch {
    return NextResponse.json({ error: 'Could not read the upload.' }, { status: 400 })
  }
  if (bytes.byteLength === 0) return NextResponse.json({ error: 'Empty body.' }, { status: 400 })
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'File too large.' }, { status: 413 })
  }

  try {
    const store = await mediaBucket(resolved.bucket)
    const object = await store.put(resolved.key, bytes, {
      httpMetadata: { contentType },
    })
    return NextResponse.json({ ok: true, key: resolved.key, size: object?.size ?? null })
  } catch (err) {
    console.error('[media PUT] failed', {
      bucket: resolved.bucket,
      key: resolved.key,
      message: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: 'Could not store the file.' }, { status: 502 })
  }
}

/** Read. Streams the object back; nothing is cached by a shared cache. */
export async function GET(req: NextRequest) {
  const resolved = await assertStaffOnKey(req)
  if (!resolved.ok) return resolved.response

  try {
    const store = await mediaBucket(resolved.bucket)
    const object = await store.get(resolved.key)
    if (!object) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

    const headers = new Headers()
    headers.set('content-type', object.httpMetadata?.contentType ?? 'application/octet-stream')
    headers.set('content-length', String(object.size))
    // Private media on a shared Worker: never let an intermediary hold it.
    headers.set('cache-control', 'private, no-store')
    return new NextResponse(object.body as unknown as ReadableStream, { headers })
  } catch (err) {
    console.error('[media GET] failed', {
      bucket: resolved.bucket,
      key: resolved.key,
      message: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: 'Could not read the file.' }, { status: 502 })
  }
}
