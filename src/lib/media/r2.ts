import 'server-only'

import { getCloudflareContext } from '@opennextjs/cloudflare'

import { type R2BucketName } from './names'

/**
 * The Worker's R2 bindings.
 *
 * The names, the key rules and the `storage_bucket` convention live in
 * `./names`, which both halves of the app import. This file is the half only
 * the server can have: the bindings themselves.
 *
 * Bindings, not credentials — there is no access key to rotate and nothing
 * secret in `wrangler.jsonc`. That is the main reason R2 was chosen for a
 * system that already spans two clouds.
 *
 * WHY THE TYPES BELOW ARE HAND-WRITTEN
 *
 * The obvious move is `wrangler types`, which emits `worker-configuration.d.ts`
 * with a real `R2Bucket`. It was tried and backed out: that file declares the
 * whole Workers runtime globally, which re-types `fetch`/`Response` (so
 * `res.json()` becomes `{}` rather than `any`) and makes `ProcessEnv` exact —
 * breaking eight unrelated call sites in auth, outbound calls and the UI
 * version test. The payoff would have been type safety on two method calls.
 * So the file is gitignored and the surface this app actually uses is spelled
 * out here instead. Add to it rather than regenerating.
 */

/** What `get()` returns. Only the fields this app reads. */
export interface MediaObject {
  body: ReadableStream
  size: number
  httpMetadata?: { contentType?: string }
}

/** The slice of R2's API this app uses. */
export interface MediaStore {
  get(key: string): Promise<MediaObject | null>
  put(
    key: string,
    value: ReadableStream | Blob | ArrayBuffer | ArrayBufferView | string,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<{ size: number } | null>
  delete(key: string): Promise<void>
}

/** Logical bucket name → the binding declared in wrangler.jsonc. */
const BINDINGS: Record<R2BucketName, string> = {
  'eventflow-call-recordings': 'MEDIA_RECORDINGS',
  'eventflow-delivery-proofs': 'MEDIA_PROOFS',
  'eventflow-exports': 'MEDIA_EXPORTS',
}

/**
 * The bucket for a logical name.
 *
 * Throws rather than returning null: every caller needs the bucket to do its
 * job, and a null here would surface as "upload succeeded, nothing stored" —
 * the one failure mode this migration must not introduce, because a
 * `call_recordings` row cannot be deleted once written.
 *
 * Under `next dev` this is Wrangler's local simulation and objects land in
 * `.wrangler/state`, not in the real bucket. That is why
 * `initOpenNextCloudflareForDev()` is called in next.config.ts.
 */
export async function mediaBucket(bucket: R2BucketName): Promise<MediaStore> {
  const { env } = await getCloudflareContext({ async: true })
  const binding = BINDINGS[bucket]
  const store = (env as unknown as Record<string, MediaStore | undefined>)[binding]
  if (!store) {
    throw new Error(
      `R2 binding ${binding} is not available. Check "r2_buckets" in wrangler.jsonc, ` +
        'and that the Worker was deployed after it was added.',
    )
  }
  return store
}

export * from './names'
