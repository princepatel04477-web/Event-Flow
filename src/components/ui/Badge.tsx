import type { HTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
  /** Slightly larger, for use as a standalone status chip on a card. */
  size?: 'sm' | 'md'
}

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-tint-neutral text-muted',
  success: 'bg-tint-success text-success',
  warning: 'bg-tint-warning text-warning',
  danger: 'bg-tint-danger text-danger',
  info: 'bg-tint-info text-info',
}

const SIZES = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-1 text-sm',
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
        'inline-flex max-w-full items-center gap-1 truncate rounded-full font-semibold',
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
