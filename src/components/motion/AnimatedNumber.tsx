'use client'

import { animate } from 'motion/react'
import { useEffect, useRef } from 'react'

import { DURATION, EASE } from '@/lib/motion/tokens'

/**
 * A whole number that glides from its previous value to the new one (M5).
 *
 * Only the digits change — there is no transform, no layout shift, no
 * width/height animation. The count-up uses motion's imperative `animate`
 * with the house curve and the standard enter duration from
 * `src/lib/motion/tokens.ts`, so a number that ticks up from 37 to 40 moves
 * the way every other change in the app does.
 *
 * Renders a bare `<span>`; the caller owns its size and colour. The first
 * paint is the real value (no count-up from zero), and a change to the same
 * value is a no-op — so a refetch that returns the same count does not
 * jitter.
 */
export function AnimatedNumber({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const prev = useRef(value)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const from = prev.current
    prev.current = value
    if (from === value) return

    node.textContent = String(from)
    const controls = animate(from, value, {
      duration: DURATION.enter,
      ease: EASE.ledger,
      onUpdate: (latest) => {
        node.textContent = String(Math.round(latest))
      },
    })
    return () => controls.stop()
  }, [value])

  return <span ref={ref}>{value}</span>
}

export default AnimatedNumber
