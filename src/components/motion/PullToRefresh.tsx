'use client'

import { animate, m, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { Spinner } from '@/components/ui/Spinner'
import { hapticTick } from '@/lib/haptics'
import { pullAllowedFrom, pullDistance, pullProgress, shouldRefresh } from '@/lib/motion/pull'
import { DISTANCE, SPRING } from '@/lib/motion/tokens'

/**
 * Pull down at the top of a screen to refresh it (M5).
 *
 * WHAT A REFRESH IS. Every query this screen is showing is refetched (TanStack
 * `refetchQueries({ type: 'active' })`) and the server components are
 * re-rendered (`router.refresh()`), so both kinds of screen in the v2 shell -
 * client lists and server-rendered Today - get fresh numbers from one gesture.
 * It never reloads the page: CLAUDE.md §11b, a reload is the action that makes
 * a bad venue connection worse.
 *
 * WHY TOUCH EVENTS, NOT POINTER EVENTS. On a touch screen the browser claims a
 * vertical drag for scrolling and fires `pointercancel`, so a pointer-driven
 * pull would die a few pixels in. `touchmove` with `passive: false` is the one
 * way to take the gesture over - and it is only taken over while the page is
 * already at the very top and the finger is moving DOWN, so ordinary scrolling
 * is never touched.
 *
 * MOTION. Transform and opacity only: the indicator rides one motion value
 * (`y`), never `top` or `height`. The release uses the house SPRING. Reduced
 * motion: the indicator jumps instead of springing.
 *
 * THE CONTENT DOES NOT MOVE, on purpose. A transform on a wrapper becomes the
 * containing block for every `position: fixed` child, so the bottom bars, the
 * sheets and the "Saved" check inside a screen would all slide down with the
 * finger. The indicator follows the finger instead, over the content.
 */
export function PullToRefresh({ children }: { children: ReactNode }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const reduced = useReducedMotion()

  const rootRef = useRef<HTMLDivElement>(null)
  const y = useMotionValue(0)
  const indicatorOpacity = useTransform(y, (v) => pullProgress(v))
  const indicatorTurn = useTransform(y, (v) => pullProgress(v) * 270)
  const indicatorY = useTransform(y, (v) => v - DISTANCE.pullHold)

  const [refreshing, setRefreshing] = useState(false)
  const refreshingRef = useRef(false)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return

    let startY: number | null = null
    let pulling = false
    let armed = false

    function settle(to: number) {
      if (reduced) {
        y.set(to)
        return
      }
      void animate(y, to, SPRING)
    }

    function onStart(e: TouchEvent) {
      if (refreshingRef.current || e.touches.length !== 1) return
      if (window.scrollY > 0) return
      if (!pullAllowedFrom(e.target instanceof Element ? e.target : null)) return
      startY = e.touches[0].clientY
      pulling = false
      armed = false
    }

    function onMove(e: TouchEvent) {
      if (startY === null) return
      const dy = e.touches[0].clientY - startY
      if (!pulling) {
        // Upward, or the page has scrolled since the touch began: not a pull.
        if (dy <= 0 || window.scrollY > 0) {
          startY = null
          return
        }
        // A few px of slop so a tap that wobbles is still a tap.
        if (dy < 6) return
        pulling = true
      }
      e.preventDefault()
      const pulled = pullDistance(dy)
      y.set(pulled)
      const nowArmed = shouldRefresh(pulled)
      if (nowArmed && !armed) hapticTick()
      armed = nowArmed
    }

    async function runRefresh() {
      refreshingRef.current = true
      setRefreshing(true)
      settle(DISTANCE.pullHold)
      try {
        router.refresh()
        await queryClient.refetchQueries({ type: 'active' })
      } finally {
        refreshingRef.current = false
        setRefreshing(false)
        settle(0)
      }
    }

    function onEnd() {
      if (startY === null) return
      startY = null
      if (!pulling) return
      pulling = false
      if (armed) {
        armed = false
        void runRefresh()
      } else {
        settle(0)
      }
    }

    root.addEventListener('touchstart', onStart, { passive: true })
    root.addEventListener('touchmove', onMove, { passive: false })
    root.addEventListener('touchend', onEnd, { passive: true })
    root.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      root.removeEventListener('touchstart', onStart)
      root.removeEventListener('touchmove', onMove)
      root.removeEventListener('touchend', onEnd)
      root.removeEventListener('touchcancel', onEnd)
    }
  }, [queryClient, reduced, router, y])

  return (
    <div ref={rootRef} className="relative flex flex-1 flex-col overscroll-y-contain">
      <m.div
        aria-hidden={!refreshing}
        className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center"
        style={{ y: indicatorY, opacity: indicatorOpacity }}
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-rule-strong bg-surface shadow-e2">
          {refreshing ? (
            <Spinner size="sm" label="Refreshing" />
          ) : (
            <m.svg
              viewBox="0 0 24 24"
              className="h-5 w-5 text-brand"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ rotate: indicatorTurn }}
            >
              <path d="M12 5v14" />
              <path d="m6 13 6 6 6-6" />
            </m.svg>
          )}
        </div>
      </m.div>
      {children}
      <span className="sr-only" role="status" aria-live="polite">
        {refreshing ? 'Refreshing' : ''}
      </span>
    </div>
  )
}

export default PullToRefresh
