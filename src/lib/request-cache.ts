import 'server-only'

import { cache } from 'react'

/**
 * Per-request memoisation for identity and event lookups.
 *
 * THE PROBLEM THIS SOLVES. A staff route resolves the same three facts twice:
 * the layout calls `getViewer()` + `resolveEventByCode()` + `getEventAccess()`
 * for the nav, and the page calls `resolveEventByCode()` + `requireStaff()`
 * again for the gate. The duplication is deliberate — a server layout cannot
 * see the pathname, so the gate has to live in the page — but it costs a
 * second full set of round trips to Seoul (~175ms each) on every navigation.
 *
 * WHY NOT PLAIN `cache()` ON THE FUNCTIONS. An earlier attempt memoised the
 * lookups directly and leaked memoised NULLs: a read that returned null (no
 * session yet, event not visible) was cached and then reused, turning a
 * transient miss into a sticky "you are not signed in". This wrapper stores
 * successes only — a null or undefined result is returned to the caller but
 * never written to the map, so the next caller re-reads.
 *
 * WHY THIS CANNOT LEAK BETWEEN REQUESTS. `cache(() => new Map())` is React's
 * request-scoped memo: React calls the factory once per render pass and
 * discards it when that pass ends. Two concurrent requests get two distinct
 * Maps, so one session's identity is never visible to another. Nothing here is
 * module-level mutable state — `store` is the memoised factory, not a Map.
 *
 * WHAT THIS IS NOT. Not a TTL cache and not cross-request: see
 * `lib/ttl-cache.ts` for the 30s counter cache. Not an authorisation
 * shortcut — every read it wraps still runs under RLS, and this only removes
 * the SECOND identical read within one request.
 */
const store = cache((): Map<string, unknown> => new Map())

/**
 * Run `fn` once per request per key, caching successes only.
 *
 * `null` and `undefined` are passed through uncached, on purpose: they are the
 * "no session" / "not visible" answers, and caching them is exactly the bug
 * that got the previous attempt reverted.
 */
export async function perRequest<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const map = store()

  if (map.has(key)) {
    return map.get(key) as T
  }

  const value = await fn()

  // Nullish means "no answer", which is frequently transient. Never sticky.
  if (value !== null && value !== undefined) {
    map.set(key, value)
  }

  return value
}

/**
 * Test seam: how many entries the current request has memoised.
 * Used by the concurrency test to prove two requests keep separate maps.
 */
export function perRequestSize(): number {
  return store().size
}
