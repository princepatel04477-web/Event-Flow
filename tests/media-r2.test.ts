import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

vi.mock('server-only', () => ({}))

import { createS3MediaStore, mediaBucket } from '@/lib/media/r2'

describe('createS3MediaStore', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env.R2_ENDPOINT = 'https://account.r2.cloudflarestorage.com'
    process.env.R2_ACCESS_KEY_ID = 'test-access-key-id-12345678901'
    process.env.R2_SECRET_ACCESS_KEY = 'test-secret-access-key-12345678901234567890123456789012'
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.restoreAllMocks()
  })

  it('fails gracefully when R2_ENDPOINT is missing', async () => {
    delete process.env.R2_ENDPOINT
    const store = createS3MediaStore('eventflow-call-recordings')
    await expect(store.get('test/key.wav')).rejects.toThrow(/R2_ENDPOINT/)
  })

  it('handles 404 correctly on get', async () => {
    const store = createS3MediaStore('eventflow-call-recordings')
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => {
      return new Response('Not found', { status: 404 })
    })

    const res = await store.get('94666864-f217-4d6a-887e-1dccd8ccec1c/rec.wav')
    expect(res).toBeNull()
  })

  it('returns body and metadata on successful get', async () => {
    const store = createS3MediaStore('eventflow-call-recordings')
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => {
      return new Response('sample-audio-bytes', {
        status: 200,
        headers: {
          'content-length': '18',
          'content-type': 'audio/wav',
        },
      })
    })

    const res = await store.get('94666864-f217-4d6a-887e-1dccd8ccec1c/rec.wav')
    expect(res).not.toBeNull()
    expect(res?.size).toBe(18)
    expect(res?.httpMetadata?.contentType).toBe('audio/wav')
    const text = await new Response(res?.body).text()
    expect(text).toBe('sample-audio-bytes')
  })

  it('puts string and buffer values successfully', async () => {
    const store = createS3MediaStore('eventflow-delivery-proofs')
    let capturedBodyText: string = ''
    let capturedContentType: string | null = null
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(
      async (req: RequestInfo | URL, init?: RequestInit) => {
        if (req instanceof Request) {
          capturedContentType = req.headers.get('content-type')
          capturedBodyText = await req.clone().text()
        } else {
          capturedContentType = (init?.headers as Record<string, string>)?.[
            'content-type'
          ] ?? null
          capturedBodyText = String(init?.body ?? '')
        }
        return new Response('', { status: 200 })
      },
    )

    const result = await store.put(
      '94666864-f217-4d6a-887e-1dccd8ccec1c/proof.jpg',
      'image-bytes',
      { httpMetadata: { contentType: 'image/jpeg' } },
    )

    expect(result).toEqual({ size: 11 })
    expect(capturedContentType).toBe('image/jpeg')
    expect(capturedBodyText).toBe('image-bytes')
  })

  it('deletes keys successfully', async () => {
    const store = createS3MediaStore('eventflow-exports')
    let capturedMethod = ''
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(
      async (req: RequestInfo | URL, init?: RequestInit) => {
        capturedMethod = req instanceof Request ? req.method : (init?.method ?? '')
        return new Response(null, { status: 204 })
      },
    )

    await store.delete('94666864-f217-4d6a-887e-1dccd8ccec1c/export.xlsx')
    expect(capturedMethod).toBe('DELETE')
  })

  it('mediaBucket falls back to S3 store outside Cloudflare context', async () => {
    const store = await mediaBucket('eventflow-call-recordings')
    expect(store).toBeDefined()
    expect(typeof store.get).toBe('function')
    expect(typeof store.put).toBe('function')
    expect(typeof store.delete).toBe('function')
  })
})
