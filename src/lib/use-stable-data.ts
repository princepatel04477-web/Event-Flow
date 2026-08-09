'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A tiny TTL cache for route data (the staleTime behaviour the routes want,
 * without adding TanStack Query to a dependency-conscious bundle).
 *
 * Why a module-level Map and not useState: a hook's state dies with the
 * component, so switching tabs (which unmounts the previous screen) would
 * throw the cache away with it — the whole point is that the SECOND visit to
 * a tab renders from cache while a background refresh happens. A module
 * cache survives tab switches for the life of the page. The event_id is in
 * the key, so switching events can never read another event's rows.
 *
 * The cache is advisory, never authoritative: after the TTL a refetch always
 * runs, and the caller still owns error handling. A stale read that the
 * server would now answer differently is an accepted trade of a 30s TTL —
 * these screens are operated by people holding a phone, not a dashboard
 * scraping live numbers.
 */

type Entry = { at: number; value: unknown }

const cache = new Map<string, Entry>()

/** Default time-to-live before a visit forces a fresh fetch. 30s. */
const DEFAULT_TTL_MS = 30_000

interface UseStableDataOptions {
  ttlMs?: number
  onError?: (e: unknown) => void
  /** Skip the initial fetch while true (for lazily-mounted screens). */
  disabled?: boolean
}

function readCache<T>(key: string, ttlMs: number): T | null {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < ttlMs) {
    return hit.value as T
  }
  return null
}

/**
 * Load data on first visit, serve the cache on subsequent visits within the
 * TTL, and background-refresh when the TTL has passed.
 *
 * `load` is the fetch producer. `key` identifies the data — include the
 * route and the event id. Returns `{ data, loading, reload }` where `loading`
 * is true only on the very first fetch (or after `reload`); a cached visit
 * renders immediately with `data` set and `loading` false.
 */
export function useStableData<T>(
  key: string,
  load: () => Promise<T>,
  { ttlMs = DEFAULT_TTL_MS, onError, disabled = false }: UseStableDataOptions = {},
) {
  // Initial state is read from the cache once; the module Map survives tab
  // switches, so a returning visit starts with data already in hand.
  const [data, setData] = useState<T | null>(() => readCache<T>(key, ttlMs))
  const [loading, setLoading] = useState(() => !disabled && readCache<T>(key, ttlMs) === null)
  const [error, setError] = useState<unknown>(null)

  // The latest key, read inside the async reload (never during render).
  const keyRef = useRef(key)
  useEffect(() => {
    keyRef.current = key
  }, [key])

  const reload = useCallback(async () => {
    const k = keyRef.current
    setLoading(true)
    setError(null)
    try {
      const value = await load()
      cache.set(k, { at: Date.now(), value })
      setData(value)
    } catch (e) {
      setError(e)
      onError?.(e)
    } finally {
      setLoading(false)
    }
  }, [load, onError])

  useEffect(() => {
    if (disabled) return
    // A fresh cache hit means the initialiser already served data with
    // loading false — nothing to do here. Otherwise fetch.
    if (readCache<T>(key, ttlMs) !== null) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, disabled, ttlMs])

  return { data, loading, error, reload }
}
