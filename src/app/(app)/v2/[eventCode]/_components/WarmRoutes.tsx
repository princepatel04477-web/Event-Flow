'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'

import { readRoomsGrid } from '@/lib/actions/rooms'
import { queryKeys } from '@/lib/query/keys'

/**
 * Warm the two screens a Home viewer is most likely to open next (S3).
 *
 * WHY. Both are one tap away from Home and both are expensive on a cold cache:
 * Rooms re-reads the whole grid and Calls re-reads the queue. Warming them
 * while the runner is still reading Home turns their first tap into a paint
 * from memory instead of a blank screen and a trip to Seoul.
 *
 * WHEN, EXACTLY. After first paint, never during it: the work is scheduled
 * through `requestIdleCallback` (with a `setTimeout` fallback for the WebView,
 * which does not always expose it) and the effect body returns before it runs.
 * Home's own paint never waits on this.
 *
 * WHAT IT PREFETCHES. The rooms QUERY (the same key and fetcher the board
 * uses, so the board hits it) and the ROUTES for rooms and calls. The calls
 * queue is a route prefetch only — its fetcher is module-private inside
 * `CallNext`, which this change is not allowed to touch — so the screen paints
 * from the warmed route payload and fetches its rows on mount.
 *
 * IT WRITES NOTHING. Both destinations are read-only on render; the one route
 * that must never be prefetched is `rsvp/status/[groupId]`, because it claims
 * the 15-minute caller lock on render (see the note in `GuestsClient`). This
 * component does not touch it.
 */
export function WarmRoutes({ eventId, eventCode }: { eventId: string; eventCode: string }) {
  const router = useRouter()
  const queryClient = useQueryClient()

  useEffect(() => {
    let cancelled = false

    const roomsHref = `/${eventCode}/hospitality/rooms`
    const callsHref = `/${eventCode}/rsvp/queue`

    const warm = () => {
      if (cancelled) return
      router.prefetch(roomsHref)
      router.prefetch(callsHref)
      void queryClient.prefetchQuery({
        queryKey: queryKeys.rooms.grid(eventId),
        queryFn: () => readRoomsGrid(eventId),
        staleTime: 30_000,
      })
    }

    // Bound through a local rather than an `in` check: lib.dom declares
    // `requestIdleCallback` as always present, so `'requestIdleCallback' in
    // window` narrows `window` itself to `never` in the fallback branch below.
    // The WebView does not always ship it, so the runtime check stays.
    const idleCallback =
      typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function'
        ? window.requestIdleCallback
        : undefined

    if (idleCallback) {
      const handle = idleCallback.call(window, warm, { timeout: 2_000 })
      return () => {
        cancelled = true
        window.cancelIdleCallback(handle)
      }
    }

    const handle = window.setTimeout(warm, 300)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [eventId, eventCode, router, queryClient])

  return null
}

export default WarmRoutes
