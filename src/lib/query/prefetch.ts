'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Thumb-driven, bounded route warming.
 *
 * WHAT THIS IS FOR. Next's default prefetch for a dynamic route is a PARTIAL
 * one: it fetches down to the nearest `loading.tsx` and stops. This app has 28
 * of those, so the default warms the skeleton and nothing else — the tap still
 * waits for Seoul, it just gets to look at a skeleton while it waits, which is
 * the wait made visible rather than removed. `prefetch` (the boolean `true`
 * form) fetches the route AND its data. That is the only prefetch worth having
 * here, and it is the one this hook arms.
 *
 * WHY A PROP FLIP AND NOT `router.prefetch()`. `router.prefetch(href)` defaults
 * to `PrefetchKind.AUTO` — the partial kind again — and the FULL kind is only
 * reachable through a `next/dist/...` private import. So the public route to a
 * full prefetch is to hand `<Link>` a `prefetch` that flips from its default to
 * `true`, which is exactly what Next's own `unstable_dynamicOnHover` does
 * internally. Hence: this hook holds a small set of ARMED hrefs, and a link
 * renders `prefetch` when its own href is in it.
 *
 * WHY BOUNDED. These are 2GB Android handsets on venue Wi-Fi measured at
 * 1.5Mbps. A fling down a 238-row list that armed a row per touch would issue
 * hundreds of full route renders against Seoul — a denial of service the team
 * would inflict on itself, on the one link it cannot replace. Two limits:
 *
 *   1. At most `PREFETCH_BUDGET` hrefs are armed at any moment. Arming a fourth
 *      evicts the oldest, which releases the slot and un-arms that link.
 *   2. Any scroll clears the armed set and silences arming for
 *      `SCROLL_QUIET_MS`. A finger that lands and then drags was scrolling, not
 *      choosing, and the row it landed on is no longer under the thumb.
 *
 * WHAT "CANCEL" HONESTLY MEANS. A request already issued cannot be recalled —
 * neither Next nor fetch gives us a handle on it. What a scroll cancels is
 * every prefetch that has not been ISSUED yet: the armed set is emptied, so
 * links drop back to their resting prefetch, and nothing new arms until the
 * scroll settles. That is the bound that matters, because the failure mode is a
 * fling arming forty rows, not one row arming once.
 *
 * WHAT THIS MUST NEVER BE POINTED AT. A full prefetch is a real server render
 * of the destination page, so any render-time write happens for real, for a
 * screen nobody opened. Two routes in this app write on render and are
 * therefore excluded on purpose — see DECISIONS.md, 21 September 2026:
 *
 *   - `rsvp/status/[groupId]` calls `claimGroupForCall`, which takes the
 *     15-minute caller lock. Locks have no manual override (CLAUDE.md §11b).
 *   - `rsvp/call/[groupId]` stamps `last_opened_by_staff`, which is what the
 *     queue's "Ravi, 2 min ago" label reads.
 *
 * Before arming a new destination, read its `page.tsx` and confirm it only
 * reads. A prefetch that writes is worse than a slow tap.
 */

/** How many destinations may be armed at once. */
export const PREFETCH_BUDGET = 3

/** Silence after the last scroll event before arming resumes. */
const SCROLL_QUIET_MS = 150

export interface BoundedPrefetch {
  /** True while `href` should render a full `prefetch`. */
  isArmed: (href: string) => boolean
  /** Call on pointerdown/touchstart. Cheap and idempotent per href. */
  arm: (href: string) => void
}

export function useBoundedPrefetch(): BoundedPrefetch {
  const [armed, setArmed] = useState<readonly string[]>([])

  // The same list, in a ref, so `arm` can read the current set without being
  // re-created on every change. These handlers are attached to every row and
  // tab on screen, and a new function identity per render is a prop change on
  // every one of them.
  const armedRef = useRef<readonly string[]>([])

  // A timestamp, not state: updating it must never re-render mid-scroll.
  const quietUntil = useRef(0)

  useEffect(() => {
    // `scroll` does not bubble, but it DOES run through the capture phase on
    // window — so this one listener covers the page AND the guest list's own
    // inner scroller, without either of them knowing this hook exists.
    const onScroll = () => {
      quietUntil.current = Date.now() + SCROLL_QUIET_MS
      // Only touch state when there is something to clear. A setState per
      // scroll event would re-render the list on every frame of a fling, which
      // is the jank this whole session exists to remove.
      if (armedRef.current.length === 0) return
      armedRef.current = []
      setArmed([])
    }

    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => window.removeEventListener('scroll', onScroll, { capture: true })
  }, [])

  const arm = useCallback((href: string) => {
    if (Date.now() < quietUntil.current) return
    if (armedRef.current.includes(href)) return

    // `slice(-PREFETCH_BUDGET)` is the eviction: the oldest armed href drops
    // out and its link falls back to its resting prefetch.
    const next = [...armedRef.current, href].slice(-PREFETCH_BUDGET)
    armedRef.current = next
    setArmed(next)
  }, [])

  const isArmed = useCallback((href: string) => armed.includes(href), [armed])

  return { isArmed, arm }
}

export default useBoundedPrefetch
