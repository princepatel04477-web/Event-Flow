/**
 * Tiny in-memory TTL cache for server-side reads that do not need to be
 * real-time (dashboard counters, attention rows).
 *
 * Why this exists: the dashboard pays a ~150ms round-trip to the Supabase
 * region (Seoul) for every view read, and the counts it shows — total pax,
 * RSVP split, hampers — do not change between two glances a few seconds
 * apart. A 30s TTL turns repeated visits into instant renders while keeping
 * the numbers fresh enough that a coordinator shouting across a room is
 * never contradicted.
 *
 * Process-scoped on purpose: in Next dev there is one process; in prod the
 * cache lives per instance, which is fine for a 30s counter that is
 * eventually consistent anyway. It is keyed by a string the caller builds
 * from the route's identity (e.g. `dashboard:${eventId}`), so one event's
 * data never leaks into another's slot.
 */
export function ttlCache<T>(ttlMs: number) {
  const store = new Map<string, { value: T; expiresAt: number }>()

  return {
    get(key: string): T | undefined {
      const entry = store.get(key)
      if (!entry) return undefined
      if (entry.expiresAt <= Date.now()) {
        store.delete(key)
        return undefined
      }
      return entry.value
    },
    set(key: string, value: T): void {
      store.set(key, { value, expiresAt: Date.now() + ttlMs })
    },
  }
}

/**
 * A stable, opaque cache key for a value that should not be held in memory.
 *
 * WHY NOT THE VALUE ITSELF. A cache entry lives for its TTL, which is longer than
 * the request that created it — so keying a cache on a session token would keep
 * that token in a module-level Map for the whole TTL. The token is already in
 * memory during the request; this keeps it from outliving it. It is a MAP KEY and
 * never a security boundary: a collision would serve one session another
 * session's *cached answer about that session's own token*, and the answer is a
 * boolean from a security-definer RPC either way.
 *
 * FNV-1a, 32 bits, non-cryptographic on purpose — a hash function here is about
 * tidiness, and a cryptographic digest per request would cost more than the
 * lookup it saves. Same construction as `sessionScope()` in
 * `src/lib/supabase/queries.ts`, which has the same job.
 */
export function fingerprint(value: string): string {
  let h = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `${(h >>> 0).toString(36)}:${value.length}`
}
