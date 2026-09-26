'use client'

import { useEffect, useState } from 'react'
import { dehydrate, hydrate, type QueryClient } from '@tanstack/react-query'
import { openDB, type IDBPDatabase } from 'idb'

/**
 * Keep the last known data on the phone (S5).
 *
 * WHY. On venue Wi-Fi a cold open is a blank screen until Seoul answers — and
 * when the signal is gone entirely, a blank screen forever. `arrivals` proved
 * the alternative: read from a cache already on the device. This persists the
 * TanStack cache to IndexedDB with the `idb` package the app already ships (no
 * new dependency) so a cold open paints yesterday's data and refreshes behind
 * it.
 *
 * WHAT IS KEPT, AND WHAT IS NOT. This is an ALLOWLIST, not a denylist: only the
 * query keys in `PERSISTABLE_HEADS` are written. Nothing with a signed URL, a
 * token or a search term is on it, and a key that is not recognised is dropped
 * rather than trusted. `isPersistableKey` is pure and tested.
 *
 * SCOPED. The store is keyed by the event code, so one event's rows can never
 * paint under another event's header — the tenancy rule the query keys already
 * enforce, applied to the disk as well. (Partitioning by STAFF identity as well
 * is a one-line change to `scopeFromPath` once the shell passes the selected
 * staff member down; today the event half is what the tenancy fence needs.)
 *
 * AGE. 24 hours. Older than that is not "yesterday's data", it is a different
 * day's event.
 */

export const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000
const SAVE_DEBOUNCE_MS = 1_000
const HYDRATE_CAP_MS = 250

const DB_NAME = 'eventflow-query-cache'
const STORE = 'caches'
const DB_VERSION = 1

/** The internal prefix plus every path that is not an event-scoped screen. */
const NON_EVENT_FIRST_SEGMENTS = new Set([
  'login',
  'admin',
  'auth',
  'pick-staff',
  'api',
  'debug',
  'design-system',
  'v2',
])

/** The event code in a pathname, or null when the path is not event-scoped. */
export function scopeFromPath(pathname: string): string | null {
  const first = pathname.split('/').filter(Boolean)[0]
  if (!first || NON_EVENT_FIRST_SEGMENTS.has(first)) return null
  return first
}

/**
 * The two leading segments after the event id that are safe to keep.
 *
 * Mirrors the screens named by S5 — board, call queue, guests list, rooms,
 * arrivals, departures, hampers, check-in. Everything else (search results,
 * one-off details) is deliberately absent.
 */
const PERSISTABLE_HEADS = new Set([
  'dashboard/board',
  'rsvp/queue',
  'guests/list',
  'rooms/grid',
  'logistics/arrivals',
  'logistics/departures',
  'hospitality/checkin',
  'deliveries/list',
])

/** Is this query key safe to write to the device? Pure, and tested. */
export function isPersistableKey(key: readonly unknown[]): boolean {
  if (key[0] !== 'event' || typeof key[1] !== 'string') return false
  const strings = key.slice(2).filter((part): part is string => typeof part === 'string')
  if (strings.length < 2) return false
  return PERSISTABLE_HEADS.has(`${strings[0]}/${strings[1]}`)
}

/** A dehydrated cache containing only the allowlisted queries. */
export function dehydrateSafe(queryClient: QueryClient) {
  const full = dehydrate(queryClient)
  return {
    ...full,
    // TanStack v5 dehydrates each query as `{ queryKey, queryHash, state }`.
    queries: full.queries.filter((query) => isPersistableKey(query.queryKey)),
    // Mutations are never persisted: a queued write is not cache, it is work,
    // and the outbox (src/lib/proof-queue.ts) is where that belongs.
    mutations: [],
  }
}

type StoredRow = { state: ReturnType<typeof dehydrateSafe>; at: number }

let dbPromise: Promise<IDBPDatabase> | null = null

function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE)
      },
    })
  }
  return dbPromise
}

export async function saveCache(scope: string, state: StoredRow['state']): Promise<void> {
  try {
    const database = await db()
    await database.put(STORE, { state, at: Date.now() } satisfies StoredRow, scope)
  } catch {
    // Private mode, a full quota, a browser without IndexedDB — the app simply
    // does not persist. It must never break the screen it is running behind.
  }
}

export async function loadCache(scope: string, maxAge = CACHE_MAX_AGE_MS): Promise<StoredRow['state'] | null> {
  try {
    const database = await db()
    const row = (await database.get(STORE, scope)) as StoredRow | undefined
    if (!row) return null
    if (Date.now() - row.at > maxAge) {
      await database.delete(STORE, scope)
      return null
    }
    return row.state
  } catch {
    return null
  }
}

/** Drop one event's cache, or every event's on sign-out. */
export async function clearCache(scope?: string): Promise<void> {
  try {
    const database = await db()
    if (scope) await database.delete(STORE, scope)
    else await database.clear(STORE)
  } catch {
    // Nothing to do — an unreadable cache is an empty cache.
  }
}

/**
 * Hydrate once, then keep the cache written back.
 *
 * Returns `ready`: false until the first hydration finishes (or the cap
 * expires), so the shell can hold the first query until the device has had its
 * say. The cap exists because a hung IndexedDB read must never be a blank app.
 *
 * The subscription writes on a 1s debounce, so a burst of query updates is one
 * write, not one per cache event.
 */
export function useCachePersistence(scope: string | null, queryClient: QueryClient): boolean {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let hydrated = false

    const finish = () => {
      if (!cancelled) setReady(true)
    }

    if (!scope) {
      // Not an event screen (the sign-in page, admin): nothing to hydrate, and
      // nothing to write. Do not hold the first paint for it.
      finish()
      return
    }

    const cap = setTimeout(finish, HYDRATE_CAP_MS)

    void (async () => {
      const state = await loadCache(scope)
      if (cancelled) return
      if (state) hydrate(queryClient, state)
      hydrated = true
      clearTimeout(cap)
      finish()
    })()

    const unsubscribe = queryClient.getQueryCache().subscribe(() => {
      // Only start writing back once hydration has finished, so the first write
      // cannot overwrite a good cache with an empty one mid-hydrate.
      if (!hydrated || cancelled) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        void saveCache(scope, dehydrateSafe(queryClient))
      }, SAVE_DEBOUNCE_MS)
    })

    return () => {
      cancelled = true
      clearTimeout(cap)
      if (timer) clearTimeout(timer)
      unsubscribe()
    }
  }, [scope, queryClient])

  return ready
}
