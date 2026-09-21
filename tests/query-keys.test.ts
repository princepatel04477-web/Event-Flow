import { describe, it, expect } from 'vitest'

import { queryKeys } from '@/lib/query/keys'

/**
 * The guard on the one property of the cache layer that can silently become a
 * tenancy bug: every key must be scoped to an event.
 *
 * `src/lib/query/keys.ts` deliberately uses TanStack's own key vocabulary, so
 * two call sites that mean the same thing share a cache entry. That is a
 * feature right up until someone adds a factory that forgets the event prefix —
 * at which point the same browser holding two events (`EventSwitcher`) can paint
 * one event's rows under another event's header, and nothing throws.
 *
 * So this test does not check the factories it happens to know about. It WALKS
 * the whole `queryKeys` object, which means a factory added later is covered the
 * moment it is written, and a nested group added later is walked too.
 */

const EVENT_A = '11111111-1111-4111-8111-111111111111'
const EVENT_B = '22222222-2222-4222-8222-222222222222'

type Factory = (...args: never[]) => unknown

interface Found {
  path: string
  fn: Factory
}

/** Depth-first walk of the key tree, so nothing has to be enumerated by hand. */
function collectFactories(node: unknown, path: string[] = []): Found[] {
  if (typeof node === 'function') {
    return [{ path: path.join('.'), fn: node as Factory }]
  }
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([key, value]) =>
      collectFactories(value, [...path, key]),
    )
  }
  return []
}

/**
 * The property under test, extracted so it can be pointed at a deliberately bad
 * key. A predicate that has never been shown to reject anything proves nothing.
 */
function isEventScoped(key: unknown, eventId: string): boolean {
  return Array.isArray(key) && key[0] === 'event' && key[1] === eventId
}

/**
 * A probe argument per factory. The second parameter's TYPE differs by factory
 * — a search factory takes a string, the queue factory takes a filter object —
 * so one generic value cannot serve them all.
 *
 * If a factory is added and is not listed here, the test FAILS with a message
 * naming it rather than skipping it. That is deliberate: a factory this file
 * cannot exercise is a factory this file cannot vouch for, and the whole point
 * is that the guard covers keys written later.
 */
const PROBE_ARGS: Record<string, unknown> = {
  'guests.search': 'sharma',
  'families.detail': 'group-1',
  'deliveries.detail': 'deliverable-1',
  'rsvp.queue': { statuses: [], side: null, callbackScheduled: false, hideLocked: false },
}

/** Call a factory with an argument its signature can actually accept. */
function call(fn: Factory, path: string, eventId: string): unknown {
  try {
    return (fn as (...a: unknown[]) => unknown)(eventId, PROBE_ARGS[path] ?? 'arg')
  } catch (e) {
    throw new Error(
      `Could not probe ${path}(): ${e instanceof Error ? e.message : String(e)}. ` +
        `Add a correctly-typed entry for it to PROBE_ARGS in tests/query-keys.test.ts.`,
    )
  }
}

const factories = collectFactories(queryKeys)

describe('query keys are event-scoped', () => {
  it('walks the whole factory tree', () => {
    // If this number drops, a factory was deleted or the tree was restructured
    // in a way the walk no longer reaches — both worth failing on, because
    // every other test in this file is `it.each` over this list and would
    // otherwise pass vacuously over an EMPTY list.
    expect(factories.length).toBeGreaterThanOrEqual(9)
    expect(factories.map((f) => f.path)).toContain('guests.list')
    expect(factories.map((f) => f.path)).toContain('rsvp.queue')
  })

  it('the predicate rejects a key that is not event-scoped (negative control)', () => {
    // Guards against the whole file passing because the assertion is inverted,
    // misspelled, or true of everything.
    expect(isEventScoped(['guests', 'list'], EVENT_A)).toBe(false)
    expect(isEventScoped(['event', EVENT_B, 'guests'], EVENT_A)).toBe(false)
    expect(isEventScoped('event', EVENT_A)).toBe(false)
    expect(isEventScoped(['event', EVENT_A, 'guests'], EVENT_A)).toBe(true)
  })

  it.each(factories)('$path begins with ["event", eventId]', ({ path, fn }) => {
    const key = call(fn, path, EVENT_A)
    expect(isEventScoped(key, EVENT_A), `${JSON.stringify(key)} is not event-scoped`).toBe(true)
  })

  it.each(factories)('$path separates one event from another', ({ path, fn }) => {
    expect(JSON.stringify(call(fn, path, EVENT_A))).not.toBe(JSON.stringify(call(fn, path, EVENT_B)))
  })

  it.each(factories)('$path is stable for identical arguments', ({ path, fn }) => {
    expect(JSON.stringify(call(fn, path, EVENT_A))).toBe(JSON.stringify(call(fn, path, EVENT_A)))
  })

  it('no two factories collide on the same arguments', () => {
    // Two factories returning the same key for DIFFERENT data is the failure
    // that has no symptom: the second screen renders the first one's rows.
    const seen = new Map<string, string>()
    for (const { path, fn } of factories) {
      const json = JSON.stringify(call(fn, path, EVENT_A))
      const prior = seen.get(json)
      expect(prior, `${path} collides with ${prior} on ${json}`).toBeUndefined()
      seen.set(json, path)
    }
  })

  it('normalises queue filter ORDER, so the same chips are one cache entry', () => {
    const base = {
      side: 'bride' as const,
      callbackScheduled: false,
      hideLocked: false,
    }
    const a = queryKeys.rsvp.queue(EVENT_A, { ...base, statuses: ['confirmed', 'callback'] })
    const b = queryKeys.rsvp.queue(EVENT_A, { ...base, statuses: ['callback', 'confirmed'] })
    expect(a).toEqual(b)
  })

  it('keeps DIFFERENT queue filters in different entries', () => {
    const base = {
      statuses: [] as const,
      side: null,
      callbackScheduled: false,
      hideLocked: false,
    }
    expect(queryKeys.rsvp.queue(EVENT_A, base)).not.toEqual(
      queryKeys.rsvp.queue(EVENT_A, { ...base, hideLocked: true }),
    )
  })

  it('separates guest search terms', () => {
    expect(queryKeys.guests.search(EVENT_A, 'sharma')).not.toEqual(
      queryKeys.guests.search(EVENT_A, 'sharm'),
    )
  })

  it('dedupes repeated statuses — same SQL .in, so the same key', () => {
    // `['confirmed','confirmed']` and `['confirmed']` produce the identical
    // `.in(...)`. Sorting alone left them as two entries for one query, which is
    // the silent re-fetch the factory exists to prevent.
    const base = { side: null, callbackScheduled: false, hideLocked: false }
    expect(
      queryKeys.rsvp.queue(EVENT_A, { ...base, statuses: ['confirmed', 'confirmed'] }),
    ).toEqual(queryKeys.rsvp.queue(EVENT_A, { ...base, statuses: ['confirmed'] }))
  })

  it('treats an undefined side the same as an explicit null', () => {
    // Keys are compared by JSON, and `{side: undefined}` drops the property
    // while `{side: null}` keeps it — so without `?? null` these are two cache
    // entries for one filter state.
    const base = { statuses: [] as const, callbackScheduled: false, hideLocked: false }
    expect(
      queryKeys.rsvp.queue(EVENT_A, { ...base, side: undefined as unknown as null }),
    ).toEqual(queryKeys.rsvp.queue(EVENT_A, { ...base, side: null }))
  })
})
