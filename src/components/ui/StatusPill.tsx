import type { HTMLAttributes } from 'react'

import { cn } from '@/lib/utils'
import type { StatusTone } from '@/lib/status'

export interface StatusPillProps extends HTMLAttributes<HTMLSpanElement> {
  /** The semantic tone. See `StatusTone` in `@/lib/status`. */
  tone?: StatusTone
  size?: 'sm' | 'md'
}

/**
 * The only component that renders a status colour. The vocabulary lives in
 * `@/lib/status`; the tone maps to the ledger palette:
 *
 * - `attention` — ledger red. Overdue, over capacity, unbalanced,
 *   destructive. The only place red is allowed.
 * - `done`      — ledger green. Delivered, confirmed, balanced.
 * - `active`    — amber. In hand, in progress (a lock, an assignment).
 * - `neutral`   — ink on paper, nothing to say.
 *
 * No ad-hoc coloured spans anywhere else. If a screen needs a colour that
 * is not one of these four, it is not a status — restyle it.
 *
 * Every pill carries its label as text, so a colour-blind coordinator
 * reads the list from the words, not the colours.
 */
export function StatusPill({
  tone = 'neutral',
  size = 'sm',
  className,
  children,
  ...props
}: StatusPillProps) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2.5 leading-none font-semibold',
        size === 'sm' ? 'min-h-6 py-1 text-xs' : 'min-h-8 py-1.5 text-sm',
        TONES[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  )
}

const TONES: Record<StatusTone, string> = {
  neutral: 'border-rule-strong bg-paper text-muted',
  // "In hand" is the ink stamp: solid ink fill, paper text. Distinct from
  // every other tone at a glance — a lock or an assignment is a definite
  // state, not a muted one. Solid ink reads correctly in both themes.
  active: 'border-rule-strong bg-ink text-paper',
  attention: 'border-transparent bg-red-tint text-ledger-red',
  done: 'border-transparent bg-green-tint text-ledger-green',
}

export default StatusPill
