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
 * `@/lib/status`; the tone maps to the Nuvent palette:
 *
 * - `attention` — signal. Overdue, over capacity, unbalanced,
 *   destructive. The only place signal is allowed.
 * - `done`      — verdigris. Delivered, confirmed, balanced, sealed.
 * - `active`    — brass. In hand, in progress (a lock, an assignment).
 * - `neutral`   — slate, nothing to say.
 *
 * No ad-hoc coloured spans anywhere else. If a screen needs a colour that
 * is not one of these four, it is not a status — restyle it.
 *
 * Set in mono, uppercase and wide-tracked so a pill never reads as prose,
 * and every pill carries its label as text — a colour-blind coordinator
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
        'inline-flex max-w-full items-center gap-1 truncate rounded-full border',
        'font-mono font-semibold tracking-eyebrow uppercase',
        size === 'sm' ? 'min-h-6 px-2.5 py-1.5 text-[0.625rem]' : 'min-h-8 px-3 py-2 text-xs',
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
  neutral: 'border-transparent bg-surface-2 text-muted',
  active: 'border-brand/35 bg-brand-tint text-brand',
  attention: 'border-transparent bg-red-tint text-ledger-red',
  done: 'border-transparent bg-green-tint text-ledger-green',
}

/**
 * The completed stamp: a solid verdigris fill with dark type.
 *
 * Reserved for the one row state that is finished and immutable — a sealed
 * proof, a logged arrival. Solid rather than tinted because it has to win
 * against everything else on the row: it is the only thing on that card
 * with nothing left to do to it.
 */
export function StampPill({ className, children, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 truncate rounded-lg',
        'bg-ledger-green px-2.5 py-1.5 font-mono text-[0.625rem] font-semibold',
        'tracking-eyebrow text-paper uppercase',
        className,
      )}
      {...props}
    >
      {children}
    </span>
  )
}

export default StatusPill
