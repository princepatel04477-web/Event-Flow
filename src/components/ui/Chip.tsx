'use client'

import type { ButtonHTMLAttributes, ReactNode } from 'react'

import { cn } from '@/lib/utils'
import type { StatusTone } from '@/lib/status'

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  selected: boolean
  children: ReactNode
  /**
   * The colour a chip takes when selected. Defaults to brass, which means
   * "this is the filter I have applied".
   *
   * Pass a status tone when the chip IS the status — the RSVP outcome
   * picker, where "Confirmed" must go green and "Unreachable" red the
   * moment it is chosen, because the chip is the thing being recorded and
   * the colour is the fastest confirmation that the right one was hit.
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
 * that shape belongs to buttons, and the whole point is that a chip and a
 * commit button never look alike.
 *
 * 48px tall so it clears a thumb, which makes a row of chips taller than it
 * looks like it needs to be. That is deliberate: these are tapped by
 * someone walking.
 */
export function Chip({ selected, children, tone = 'active', className, ...props }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        'tap inline-flex min-h-12 shrink-0 items-center justify-center rounded-full border px-4',
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
