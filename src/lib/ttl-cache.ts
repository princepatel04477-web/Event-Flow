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
