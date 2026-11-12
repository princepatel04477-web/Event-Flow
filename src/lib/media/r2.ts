import 'server-only'

import { getCloudflareContext } from '@opennextjs/cloudflare'
import { AwsClient } from 'aws4fetch'

import { type R2BucketName } from './names'

/**
 * The Worker's R2 bindings.
 *
 * The names, the key rules and the `storage_bucket` convention live in
 * `./names`, which both halves of the app import. This file is the half only
 * the server can have: the bindings themselves, with an S3 API fallback
 * through aws4fetch when running outside Cloudflare (e.g. self-hosted Node.js).
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

let s3ClientInstance: AwsClient | null = null

function getS3Client(): AwsClient {
  if (s3ClientInstance) return s3ClientInstance
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      'R2 S3 credentials missing: R2_ACCESS_KEY_ID or R2_SECRET_ACCESS_KEY is not set.',
    )
  }
  s3ClientInstance = new AwsClient({
    accessKeyId,
    secretAccessKey,
    service: 's3',
    region: 'auto',
  })
  return s3ClientInstance
}

function resolveActualBucketName(bucket: R2BucketName): string {
  if (bucket === 'eventflow-call-recordings' && process.env.R2_BUCKET_RECORDINGS) {
    return process.env.R2_BUCKET_RECORDINGS
  }
  if (bucket === 'eventflow-delivery-proofs' && process.env.R2_BUCKET_PROOFS) {
    return process.env.R2_BUCKET_PROOFS
  }
  if (bucket === 'eventflow-exports' && process.env.R2_BUCKET_EXPORTS) {
    return process.env.R2_BUCKET_EXPORTS
  }
  return bucket
}

function getS3ObjectUrl(bucket: R2BucketName, key: string): string {
  const endpoint = (process.env.R2_ENDPOINT || '').replace(/\/$/, '')
  if (!endpoint) {
    throw new Error('R2_ENDPOINT environment variable is not set.')
  }
  const actualBucket = resolveActualBucketName(bucket)
  const encodedKey = key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  return `${endpoint}/${actualBucket}/${encodedKey}`
}

async function toBufferAndSize(
  value: ReadableStream | Blob | ArrayBuffer | ArrayBufferView | string,
): Promise<{ buffer: ArrayBuffer | ArrayBufferView | string; size: number }> {
  if (typeof value === 'string') {
    const encoded = new TextEncoder().encode(value)
    return { buffer: encoded, size: encoded.byteLength }
  }
  if (value instanceof ArrayBuffer) {
    return { buffer: value, size: value.byteLength }
  }
  if (ArrayBuffer.isView(value)) {
    return { buffer: value, size: value.byteLength }
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    const ab = await value.arrayBuffer()
    return { buffer: ab, size: ab.byteLength }
  }
  if (value && typeof (value as ReadableStream).getReader === 'function') {
    const reader = (value as ReadableStream).getReader()
    const chunks: Uint8Array[] = []
    let totalLength = 0
    while (true) {
      const { done, value: chunk } = await reader.read()
      if (done) break
      if (chunk) {
        chunks.push(chunk)
        totalLength += chunk.byteLength
      }
    }
    const combined = new Uint8Array(totalLength)
    let offset = 0
    for (const c of chunks) {
      combined.set(c, offset)
      offset += c.byteLength
    }
    return { buffer: combined, size: totalLength }
  }
  throw new Error('Unsupported value type for MediaStore.put')
}

export function createS3MediaStore(bucket: R2BucketName): MediaStore {
  return {
    async get(key: string): Promise<MediaObject | null> {
      const client = getS3Client()
      const url = getS3ObjectUrl(bucket, key)
      const res = await client.fetch(url, { method: 'GET' })
      if (res.status === 404) {
        return null
      }
      if (!res.ok) {
        const errorText = await res.text().catch(() => '')
        throw new Error(`R2 S3 GET failed with status ${res.status}: ${errorText}`)
      }
      const size = Number(res.headers.get('content-length') ?? 0)
      const contentType = res.headers.get('content-type') || undefined
      return {
        body: (res.body ?? new ReadableStream({ start(c) { c.close() } })) as unknown as ReadableStream,
        size,
        httpMetadata: contentType ? { contentType } : undefined,
      }
    },

    async put(
      key: string,
      value: ReadableStream | Blob | ArrayBuffer | ArrayBufferView | string,
      options?: { httpMetadata?: { contentType?: string } },
    ): Promise<{ size: number } | null> {
      const client = getS3Client()
      const url = getS3ObjectUrl(bucket, key)
      const { buffer, size } = await toBufferAndSize(value)
      const headers: Record<string, string> = {
        'content-type': options?.httpMetadata?.contentType || 'application/octet-stream',
      }
      const res = await client.fetch(url, {
        method: 'PUT',
        headers,
        body: buffer as unknown as BodyInit,
      })
      if (!res.ok) {
        const errorText = await res.text().catch(() => '')
        throw new Error(`R2 S3 PUT failed with status ${res.status}: ${errorText}`)
      }
      return { size }
    },

    async delete(key: string): Promise<void> {
      const client = getS3Client()
      const url = getS3ObjectUrl(bucket, key)
      const res = await client.fetch(url, { method: 'DELETE' })
      if (!res.ok && res.status !== 404) {
        const errorText = await res.text().catch(() => '')
        throw new Error(`R2 S3 DELETE failed with status ${res.status}: ${errorText}`)
      }
    },
  }
}

/**
 * The bucket for a logical name.
 *
 * Uses the Cloudflare Worker binding when getCloudflareContext provides it;
 * otherwise uses R2's S3 API with R2_* env vars through aws4fetch.
 */
export async function mediaBucket(bucket: R2BucketName): Promise<MediaStore> {
  try {
    const { env } = await getCloudflareContext({ async: true })
    const binding = BINDINGS[bucket]
    const store = (env as unknown as Record<string, MediaStore | undefined>)[binding]
    if (store) {
      return store
    }
  } catch {
    // Outside Cloudflare Workers runtime (Node.js self-hosted, Next dev/start, scripts)
  }

  return createS3MediaStore(bucket)
}

export * from './names'
