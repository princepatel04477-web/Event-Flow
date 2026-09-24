import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fingerprint, ttlCache } from '@/lib/ttl-cache'

/**
 * The cache key helper added by PERF-MEASURE.
 *
 * `fingerprint()` keys the code-liveness cache in `src/lib/auth/server.ts`, which
 * is what lets the app stop asking Supabase whether a session's access code is
 * still live on every single navigation while still noticing a revocation within
 * a minute. A key function that collides would hand one session another session's
 * answer about its OWN token, so the properties below are the load-bearing ones:
 * stable, distinct, and never the token itself.
 */
describe('fingerprint', () => {
  it('is stable for the same input', () => {
    const token = 'eyJhbGciOiJIUzI1NiJ9.payload.signature'
    expect(fingerprint(token)).toBe(fingerprint(token))
  })

  it('differs for tokens that differ by one character', () => {
    expect(fingerprint('aaaaaaaa')).not.toBe(fingerprint('aaaaaaab'))
  })

  it('differs for the same characters in a different order', () => {
    expect(fingerprint('ab')).not.toBe(fingerprint('ba'))
  })

  it('carries the length, so a truncation cannot masquerade as a match', () => {
    expect(fingerprint('abc')).toContain(':3')
    expect(fingerprint('abcdef')).toContain(':6')
  })

  it('does not contain the value it fingerprints', () => {
    const token = 'a-very-recognisable-token-value'
    expect(fingerprint(token)).not.toContain('recognisable')
    expect(fingerprint(token).length).toBeLessThan(token.length)
  })

  it('handles the empty string without throwing', () => {
    expect(typeof fingerprint('')).toBe('string')
  })
})

describe('ttlCache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('answers undefined for a key it has never seen', () => {
    expect(ttlCache<number>(1000).get('nope')).toBeUndefined()
  })

  it('returns a value inside its TTL and forgets it after', () => {
    const cache = ttlCache<number>(1000)
    cache.set('a', 1)
    expect(cache.get('a')).toBe(1)
    vi.advanceTimersByTime(999)
    expect(cache.get('a')).toBe(1)
    vi.advanceTimersByTime(1)
    expect(cache.get('a')).toBeUndefined()
  })

  it('keeps events apart, because the caller builds a scoped key', () => {
    const cache = ttlCache<string>(1000)
    cache.set('event:a', 'one')
    cache.set('event:b', 'two')
    expect(cache.get('event:a')).toBe('one')
    expect(cache.get('event:b')).toBe('two')
  })

  it('re-setting a key restarts its clock', () => {
    const cache = ttlCache<number>(1000)
    cache.set('a', 1)
    vi.advanceTimersByTime(900)
    cache.set('a', 2)
    vi.advanceTimersByTime(900)
    expect(cache.get('a')).toBe(2)
  })

  it('can cache "true" without confusing it for a miss', () => {
    // The liveness cache in src/lib/auth/server.ts stores only `true`, and a miss
    // is `undefined`. If a falsy value were used as the sentinel the two would be
    // indistinguishable and every request would re-ask the database.
    const cache = ttlCache<true>(1000)
    cache.set('live', true)
    expect(cache.get('live')).toBe(true)
    expect(cache.get('other')).toBeUndefined()
  })
})
