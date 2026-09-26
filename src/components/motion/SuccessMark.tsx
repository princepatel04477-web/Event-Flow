'use client'

import { m } from 'motion/react'

import { DURATION, EASE, SPRING } from '@/lib/motion/tokens'

/**
 * A check that draws itself, once, when something has been saved (M1).
 *
 * WHY IT IS DRAWN AND NOT JUST SHOWN. A tick that appears is a new glyph on a
 * screen the runner is already reading; a tick that DRAWS is the app saying the
 * write landed. It is the one moment where a flourish is honest, because it
 * happens only after a save the user asked for.
 *
 * TIMING. The stroke draws with `DURATION.fade` on the confirmation curve
 * (`EASE.seal`, the symmetric one, reserved for this), then the whole mark
 * settles with THE spring from `tokens.ts` — no second duration, no second
 * curve, nothing invented.
 *
 * COLOUR comes from `currentColor`, so the caller chooses the token (normally
 * `text-ledger-green`) and this component never names a colour.
 *
 * Reduced motion: MotionConfig holds transform animations at their final value
 * and `pathLength` is left completed, so the mark is simply there.
 */
export function SuccessMark({ className }: { className?: string }) {
  return (
    <m.span
      aria-hidden
      className={className}
      style={{ display: 'inline-flex' }}
      initial={{ scale: 0.96 }}
      animate={{ scale: 1 }}
      transition={SPRING}
    >
      <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" aria-hidden>
        <m.path
          d="M5 12.75 10 17.5 19 7.5"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: DURATION.fade, ease: EASE.seal }}
        />
      </svg>
    </m.span>
  )
}

export default SuccessMark
