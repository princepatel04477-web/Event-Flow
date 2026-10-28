import { NextResponse, type NextRequest } from 'next/server'

import { eventIdFromKey, isSafeKey, mediaBucket, resolveBucket } from '@/lib/media/r2'

/**
 * Server-to-server read, for the Supabase Edge Functions.
 *
 * WHY THIS EXISTS AT ALL
 *
 * `transcribe-recording` runs on Supabase and has to hand Sarvam the audio.
 * While the audio lived in Supabase Storage it signed its own URL. The audio
 * is in R2 now, which the Edge Function cannot reach: R2 is a Worker binding,
 * not a public API, and giving Supabase an S3 access key would put a
 * rotatable credential into a second cloud — the exact thing bindings avoid.
 *
 * So the Worker lends it the bytes, over one shared secret.
 *
 * WHY IT IS SEPARATE FROM `/api/media`
 *
 * That route authorises a human session and fences every key by event. This
 * one authorises a machine and therefore CANNOT do that — the Edge Function
 * has no session and legitimately reads any event's audio. A single route
 * with two auth modes would mean one `if` standing between a staff session
 * and every event's media. Kept apart, the blast radius of this file is
 * exactly "whoever holds MEDIA_FETCH_SECRET", and that is visible in its name.
 */

export const dynamic = 'force-dynamic'

/**
 * Compare in constant time. A plain `===` on a secret leaks its length and
 * prefix to a patient caller through response timing.
 */
function secretMatches(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < given.length; i += 1) {
    diff |= given.charCodeAt(i) ^ expected.charCodeAt(i)
  }
  return diff === 0
}

export async function GET(req: NextRequest) {
  const expected = process.env.MEDIA_FETCH_SECRET
  if (!expected) {
    console.error('[media internal] MEDIA_FETCH_SECRET is not set on this Worker')
    return NextResponse.json({ error: 'Not configured.' }, { status: 503 })
  }

  const given = req.headers.get('x-media-secret') ?? ''
  if (!secretMatches(given, expected)) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }

  const params = req.nextUrl.searchParams
  const storageBucket = params.get('bucket') ?? ''
  const key = params.get('key') ?? ''

  if (!isSafeKey(key) || !eventIdFromKey(key)) {
    return NextResponse.json({ error: 'Bad object key.' }, { status: 400 })
  }

  let resolved
  try {
    resolved = resolveBucket(storageBucket)
  } catch {
    return NextResponse.json({ error: 'Unknown bucket.' }, { status: 400 })
  }
  if (resolved.kind !== 'r2') {
    // A Supabase-backed row never needs this route — the caller can sign its
    // own URL. Refusing is honest; proxying would hide a caller that has not
    // been updated.
    return NextResponse.json({ error: 'That object is not in R2.' }, { status: 400 })
  }

  try {
    const store = await mediaBucket(resolved.bucket)
    const object = await store.get(key)
    if (!object) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

    const headers = new Headers()
    headers.set('content-type', object.httpMetadata?.contentType ?? 'application/octet-stream')
    headers.set('content-length', String(object.size))
    headers.set('cache-control', 'private, no-store')
    return new NextResponse(object.body as unknown as ReadableStream, { headers })
  } catch (err) {
    console.error('[media internal] read failed', {
      bucket: resolved.bucket,
      key,
      message: err instanceof Error ? err.message : String(err),
    })
    return NextResponse.json({ error: 'Could not read the file.' }, { status: 502 })
  }
}
