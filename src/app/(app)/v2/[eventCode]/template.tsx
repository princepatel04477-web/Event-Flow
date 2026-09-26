'use client'

import { m } from 'motion/react'
import { usePathname } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'

import { DURATION, DISTANCE, EASE, SPRING } from '@/lib/motion/tokens'

/**
 * The one screen-entrance for the v2 shell (M1).
 *
 * A `template.tsx` re-mounts on every navigation inside `[eventCode]`, which is
 * exactly what an entrance wants: the main column arrives with a small rise and
 * a fade rather than swapping in place.
 *
 * TABS ARE PEERS, NOT A STACK. Moving between two bottom-tab sections is a
 * lateral move, so it CROSSFADES only — a rise there would imply a hierarchy
 * that does not exist and makes the bar feel like it is pushing pages around.
 * The section segment (`/event/section/...`) is what distinguishes the two: a
 * change of section is a tab move, anything else is a drill-down.
 *
 * `lastSection` is module scope because the component REMOUNTS each time — a
 * ref would reset and every navigation would look like a drill-down. It is
 * client-only state, one per browser, and it holds a string.
 *
 * Distances and timing come from `src/lib/motion/tokens.ts`; nothing here is a
 * literal. Reduced motion is handled by `MotionConfig` in MotionProvider.
 */
let lastSection: string | null = null

export default function AppEventTemplate({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const section = pathname.split('/').filter(Boolean)[1] ?? ''
  const isPeerMove = lastSection === section

  useEffect(() => {
    lastSection = section
  }, [section])

  return (
    <m.div
      className="flex min-h-0 w-full flex-1 flex-col"
      initial={{ opacity: 0, y: isPeerMove ? 0 : DISTANCE.rise }}
      animate={{ opacity: 1, y: 0 }}
      transition={isPeerMove ? { duration: DURATION.fade, ease: EASE.ledger } : SPRING}
    >
      {children}
    </m.div>
  )
}
