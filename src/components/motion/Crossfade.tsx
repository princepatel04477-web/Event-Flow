'use client'

import { m } from 'motion/react'
import type { ReactNode } from 'react'

import { fadeVariants } from '@/lib/motion/tokens'
import { cn } from '@/lib/utils'

/**
 * A quick opacity crossfade for content that replaces a skeleton (M5).
 *
 * The skeleton -> content handoff should fade in rather than swap hard, using
 * the quick fade token (`DURATION.fade` / `fadeVariants`), the same 150ms
 * opacity used everywhere else on the touch path. Reduced motion is handled by
 * `MotionConfig reducedMotion="user"` in MotionProvider: opacity holds at its
 * final value, so the content is simply there.
 */
export function Crossfade({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <m.div variants={fadeVariants} initial="hidden" animate="visible" className={cn(className)}>
      {children}
    </m.div>
  )
}

export default Crossfade
