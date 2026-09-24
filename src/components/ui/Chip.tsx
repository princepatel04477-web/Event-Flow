'use client'

import type { ButtonHTMLAttributes, ReactNode } from 'react'

import { cn } from '@/lib/utils'
import type { StatusTone } from '@/lib/status'

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  selected: boolean
  children: ReactNode
  /**
   * The colour a chip takes when selected. Defaults to `active` — maroon,
   * which means "this is the filter I have applied".
   *
   * Pass a status tone when the chip IS the status — the RSVP outcome
   * picker, where "Coming" must go green and "No answer" red the moment it
   * is chosen, because the chip is the thing being recorded and the colour
   * is the fastest confirmation that the right one was hit.
   */
  tone?: StatusTone
}

const SELECTED: Record<StatusTone, string> = {
  neutral: 'border-ink bg-ink text-paper',
  active: 'border-brand bg-brand-tint text-brand',
  attention: 'border-ledger-red bg-red-tint text-ledger-red',
  done: 'border-ledger-green bg-green-tint text-ledger-green',
}

/**
 * A filter or a choice. Always a full pill, never a rounded rectangle —
 * that shape belongs to buttons and segments, and the whole point is that a
 * chip and a commit button never look alike.
 *
 * 44px tall, the app's tap floor. It used to be 40px on the theory that a
 * wide pill is a large enough target on its own, but `.tap` only sets
 * `touch-action` — it carries no minimum height — so the smallest chips sat
 * under 44px with nothing enforcing the floor (m4).
 */
export function Chip({ selected, children, tone = 'active', className, ...props }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        'tap inline-flex min-h-11 shrink-0 items-center justify-center rounded-full border px-4',
        'text-sm leading-none font-medium whitespace-nowrap',
        'transition-colors duration-press ease-ledger',
        selected
          ? SELECTED[tone]
          : 'border-rule-strong bg-surface text-muted active:bg-surface-2',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}

export default Chip
