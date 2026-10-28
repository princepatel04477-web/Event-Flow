/**
 * The media store's key rules.
 *
 * These are not formatting helpers. On Supabase Storage the tenancy fence was
 * a bucket policy — the object's first path segment was read with
 * `(storage.foldername(name))[1]`, cast to uuid, and checked against
 * `app.is_staff`, so no application bug could widen it. R2 has no equivalent.
 * `eventIdFromKey` and `isSafeKey` are what `/api/media` uses instead, which
 * makes them the whole fence between one event's recordings and another's.
 *
 * The other half is `resolveBucket`, which has to keep answering "Supabase"
 * forever for rows written before the cutover: `call_recordings` and
 * `delivery_proofs` carry `no_update` triggers, so those rows can never be
 * repointed by anyone, including the service role.
 */
import { describe, expect, it } from 'vitest'

import {
  eventIdFromKey,
  isR2Bucket,
  isSafeKey,
  r2BucketValue,
  resolveBucket,
  R2_FOR_LEGACY,
} from '@/lib/media/names'

const EVENT = '94666864-f217-4d6a-887e-1dccd8ccec1c'

describe('eventIdFromKey', () => {
  it('reads the event id from the first segment', () => {
    expect(eventIdFromKey(`${EVENT}/group/file.m4a`)).toBe(EVENT)
  })

  it('refuses a first segment that is not a uuid', () => {
    // Without this, a key like `public/anything.m4a` would have no event to
    // check against and the access test would have nothing to fail on.
    expect(eventIdFromKey('public/file.m4a')).toBeNull()
    expect(eventIdFromKey('file.m4a')).toBeNull()
    expect(eventIdFromKey('')).toBeNull()
  })
})

describe('isSafeKey', () => {
  it('accepts a key this app generates', () => {
    expect(isSafeKey(`${EVENT}/8e29a1f4-0000-4000-8000-000000000000/harvested-x.wav`)).toBe(true)
  })

  it('rejects traversal out of the event prefix', () => {
    expect(isSafeKey(`${EVENT}/../other/file.m4a`)).toBe(false)
    expect(isSafeKey(`${EVENT}/./file.m4a`)).toBe(false)
  })

  it('rejects a leading slash and empty segments', () => {
    // `/x` and `a//b` can address a different object than they appear to.
    expect(isSafeKey(`/${EVENT}/file.m4a`)).toBe(false)
    expect(isSafeKey(`${EVENT}//file.m4a`)).toBe(false)
  })

  it('rejects a key with no event prefix at all', () => {
    expect(isSafeKey('file.m4a')).toBe(false)
  })

  it('rejects an absurdly long key', () => {
    expect(isSafeKey(`${EVENT}/${'a'.repeat(2000)}.m4a`)).toBe(false)
  })
})

describe('resolveBucket', () => {
  it('sends a prefixed value to R2', () => {
    expect(resolveBucket('r2:eventflow-call-recordings')).toEqual({
      kind: 'r2',
      bucket: 'eventflow-call-recordings',
    })
  })

  it('keeps sending pre-cutover rows to Supabase', () => {
    // The rows that cannot ever be migrated, because their tables forbid UPDATE.
    expect(resolveBucket('call-recordings')).toEqual({
      kind: 'supabase',
      bucket: 'call-recordings',
    })
    expect(resolveBucket('delivery-proofs')).toEqual({
      kind: 'supabase',
      bucket: 'delivery-proofs',
    })
  })

  it('throws on an R2 bucket it does not know', () => {
    // Guessing would read or write the wrong bucket; both fail silently later.
    expect(() => resolveBucket('r2:something-else')).toThrow(/Unknown R2 bucket/)
  })
})

describe('bucket naming', () => {
  it('round-trips a bucket through its storage_bucket value', () => {
    const value = r2BucketValue('eventflow-delivery-proofs')
    expect(isR2Bucket(value)).toBe(true)
    expect(resolveBucket(value)).toEqual({ kind: 'r2', bucket: 'eventflow-delivery-proofs' })
  })

  it('maps every legacy bucket to exactly one R2 bucket', () => {
    expect(R2_FOR_LEGACY).toEqual({
      'call-recordings': 'eventflow-call-recordings',
      'delivery-proofs': 'eventflow-delivery-proofs',
      'eventflow-exports': 'eventflow-exports',
    })
  })

  it('does not mistake a bare bucket name for an R2 one', () => {
    expect(isR2Bucket('eventflow-exports')).toBe(false)
  })
})
