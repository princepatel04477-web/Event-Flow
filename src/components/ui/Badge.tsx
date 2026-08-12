import type { HTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
  /** Slightly larger, for use as a standalone chip on a card. */
  size?: 'sm' | 'md'
}

/**
 * A non-status label: a side ("BRIDE"), a kind ("HAMPER"), a count.
 *
 * If the thing you are labelling has a *state*, reach for `StatusPill`
 * instead — that component owns the four status tones and the vocabulary
 * in `@/lib/status`. This one is for facts that never change colour.
 */
const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-2 text-muted',
  success: 'bg-green-tint text-ledger-green',
  warning: 'bg-brand-tint text-brand',
  danger: 'bg-red-tint text-ledger-red',
  info: 'bg-surface-2 text-muted',
}

const SIZES = {
  sm: 'px-2 py-1 text-[0.625rem]',
  md: 'px-2.5 py-1.5 text-xs',
} as const

export function Badge({
  tone = 'neutral',
  size = 'sm',
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 truncate rounded-md',
        'font-mono font-medium tracking-eyebrow uppercase',
        TONES[tone],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  )
}

export default Badge
