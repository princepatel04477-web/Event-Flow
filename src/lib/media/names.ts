/**
 * Bucket names and key rules for the media store.
 *
 * Deliberately free of `server-only` and of any Worker binding, because both
 * halves need these: the browser builds keys and reads `storage_bucket` off
 * rows it already has, and the Worker resolves the same values to a bucket.
 * Splitting the strings from the binding is what lets `proof.ts` — a client
 * module — write a correct `storage_bucket` without importing the server.
 */

/** Marks a `storage_bucket` value as living in R2 rather than Supabase. */
export const R2_PREFIX = 'r2:'

export const R2_BUCKETS = [
  'eventflow-call-recordings',
  'eventflow-delivery-proofs',
  'eventflow-exports',
] as const

export type R2BucketName = (typeof R2_BUCKETS)[number]

/**
 * What each Supabase bucket becomes. A map rather than a string transform, so
 * renaming one bucket cannot silently rename the others.
 */
export const R2_FOR_LEGACY: Record<string, R2BucketName> = {
  'call-recordings': 'eventflow-call-recordings',
  'delivery-proofs': 'eventflow-delivery-proofs',
  'eventflow-exports': 'eventflow-exports',
}

export function isR2Bucket(storageBucket: string): boolean {
  return storageBucket.startsWith(R2_PREFIX)
}

/** The value to write into `storage_bucket` for a newly stored object. */
export function r2BucketValue(bucket: R2BucketName): string {
  return `${R2_PREFIX}${bucket}`
}

/**
 * Where a stored object lives.
 *
 * `kind: 'supabase'` is not a legacy curiosity — it is the permanent answer
 * for every row written before the cutover. `call_recordings` and
 * `delivery_proofs` carry `no_update`/`no_delete` triggers, so those rows can
 * never be repointed by anyone, including the service role. Both branches
 * have to keep working.
 */
export function resolveBucket(
  storageBucket: string,
): { kind: 'r2'; bucket: R2BucketName } | { kind: 'supabase'; bucket: string } {
  if (!isR2Bucket(storageBucket)) return { kind: 'supabase', bucket: storageBucket }
  const name = storageBucket.slice(R2_PREFIX.length)
  if (!(R2_BUCKETS as readonly string[]).includes(name)) {
    // An unknown R2 bucket is a bug, not something to guess at: reading the
    // wrong bucket 404s confusingly, and writing to one scatters objects
    // nothing can find again.
    throw new Error(`Unknown R2 bucket in storage_bucket: ${storageBucket}`)
  }
  return { kind: 'r2', bucket: name as R2BucketName }
}

/**
 * The event id a key belongs to.
 *
 * Every key in every one of these buckets starts with the event id. That was
 * true on Supabase because the bucket policy read it with
 * `(storage.foldername(name))[1]` and cast it to uuid; it stays true here
 * because it is now the ONLY thing standing between one event's media and
 * another's. R2 has no row-level security.
 */
export function eventIdFromKey(key: string): string | null {
  const first = key.split('/')[0]
  if (!first) return null
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(first)
  return isUuid ? first : null
}

/**
 * Reject keys that could escape their event prefix or address something else.
 * `..` never appears in a key this app generates, so a key containing one
 * arrived from somewhere it should not have.
 */
export function isSafeKey(key: string): boolean {
  if (!key || key.length > 1024) return false
  if (key.startsWith('/') || key.includes('//')) return false
  if (key.split('/').some((seg) => seg === '.' || seg === '..')) return false
  return eventIdFromKey(key) !== null
}
