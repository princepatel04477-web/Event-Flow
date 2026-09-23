'use client'

import { MinusIcon, PlusIcon } from '@/components/icons'
import { cn } from '@/lib/utils'

export interface StepperProps {
  /** What is being counted — "Adults", "Kids". Rendered at the row's start. */
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  /** How much one tap moves it. Default 1. */
  step?: number
  disabled?: boolean
  className?: string
}

/**
 * `−  n  +` — the one numeric control in the app.
 *
 * NO TEXT INPUT, deliberately. This counts adults and children in a family
 * while the caller is still on the phone to them; a keypad summons the
 * keyboard, covers half the screen and lets "6" become "66". Two 44px
 * buttons and a readout is faster and cannot produce a number the caller
 * did not mean.
 *
 * `role="group"` with an `aria-label`, and the value in a `role="status"`
 * region: a screen reader announces each change instead of leaving the
 * readout silent. The buttons carry the label ("Decrease Adults") so a
 * screen-reader user knows which stepper they are on without hunting.
 */
export function Stepper({
  label,
  value,
  onChange,
  min = 0,
  max = 99,
  step = 1,
  disabled = false,
  className,
}: StepperProps) {
  const lower = Math.min(min, max)
  const upper = Math.max(min, max)
  const atMin = value <= lower
  const atMax = value >= upper

  function move(delta: number) {
    const next = Math.min(upper, Math.max(lower, value + delta))
    if (next !== value) onChange(next)
  }

  const buttonClass =
    'tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-rule-strong ' +
    'bg-surface text-ink transition-colors duration-press ease-ledger ' +
    'active:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed'

  return (
    <div
      role="group"
      aria-label={label}
      className={cn('flex w-full items-center justify-between gap-3', className)}
    >
      <span className="min-w-0 truncate text-base leading-snug font-medium text-ink">
        {label}
      </span>

      <span className="flex shrink-0 items-center gap-3">
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          onClick={() => move(-step)}
          disabled={disabled || atMin}
          className={buttonClass}
        >
          <MinusIcon className="h-5 w-5" />
        </button>

        <span
          role="status"
          aria-live="polite"
          className="figure w-8 text-center text-lg leading-none font-semibold text-ink"
        >
          {value}
        </span>

        <button
          type="button"
          aria-label={`Increase ${label}`}
          onClick={() => move(step)}
          disabled={disabled || atMax}
          className={buttonClass}
        >
          <PlusIcon className="h-5 w-5" />
        </button>
      </span>
    </div>
  )
}

export default Stepper
