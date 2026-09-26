'use client'

import { m } from 'motion/react'
import { Children, useEffect, useState, type ReactNode } from 'react'

import { claimHomeEntrance } from '@/lib/motion/cold-start'
import { DISTANCE, DURATION, EASE } from '@/lib/motion/tokens'

const STAGGER_MS = 40

/**
 * Home's staggered entrance (M3): the hero first, then each following section
 * 40ms later, rising 8px and fading in over the standard enter duration. Only
 * the first open of the session plays it — a tab switch back to Home renders
 * at rest, so the entrance never slows the one screen a runner returns to
 * most.
 *
 * ── Why `idle` renders at rest ─────────────────────────────────────────────
 * The claim reads sessionStorage, which the server does not have. Rendering
 * `idle` (fully visible, `initial={false}`) on the server and the first client
 * paint means both sides agree (no hydration mismatch) and a slow or failed
 * script leaves the screen visible, not blank. The claim then resolves in a
 * 0ms timeout — a macrotask clear of hydration, the same seam the welcome
 * overlay uses — and the entrance runs only when it is genuinely the first
 * open.
 *
 * ── Why the `key` bump ──────────────────────────────────────────────────────
 * Motion reads `initial` once, at mount. Changing `initial` after the fact is
 * a no-op, so the first open re-mounts the section with `initial` set to the
 * hidden pose and `animate` to the resting one. That re-mount is one frame on
 * the first open only; a revisit keeps the `idle` key and never re-mounts.
 */
export function HomeEntrance({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<'idle' | 'entering' | 'settled'>('idle')

  useEffect(() => {
    const id = window.setTimeout(() => {
      setPhase(claimHomeEntrance() ? 'entering' : 'settled')
    }, 0)
    return () => window.clearTimeout(id)
  }, [])

  const entering = phase === 'entering'
  const items = Children.toArray(children)

  return (
    <div data-screen="home" className="flex flex-col gap-5">
      {items.map((child, index) => (
        <m.div
          key={entering ? `entering-${index}` : `idle-${index}`}
          initial={entering ? { opacity: 0, y: DISTANCE.rise } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: DURATION.enter,
            ease: EASE.ledger,
            delay: entering ? (index * STAGGER_MS) / 1000 : 0,
          }}
        >
          {child}
        </m.div>
      ))}
    </div>
  )
}

export default HomeEntrance
