'use client'

import { cn } from '@/lib/utils'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  /** The count in the label — "Waiting (14)". Omit for no count. */
  count?: number
}

export interface SegmentedProps<T extends string> {
  label: string
  value: T
  options: readonly SegmentedOption<T>[]
  onChange: (value: T) => void
  className?: string
}

/**
 * Two or three views of the SAME list of things, one visible at a time.
 *
 * Not a `Chip` row, deliberately. Chips are filters — several can be on, and
 * turning them all off is a meaningful state. This is a switch: exactly one
 * segment is showing and there is no "neither". Giving the two behaviours the
 * same shape is how a filter row starts getting tapped like a switch.
 *
 * `role="tablist"` rather than a radio group, because that is what it is: the
 * panel below changes wholesale. 48px tall so it clears a thumb.
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: SegmentedProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        'flex w-full gap-1 rounded-xl border border-rule-strong bg-surface-2 p-1',
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'tap min-h-12 flex-1 rounded-lg px-3 text-sm font-semibold leading-none',
              'transition-colors duration-press ease-ledger',
              selected
                ? 'bg-surface text-ink shadow-e1'
                : 'bg-transparent text-muted active:bg-surface',
            )}
          >
            {option.label}
            {option.count === undefined ? null : (
              <span className="figure ml-1.5 font-normal">({option.count})</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export default Segmented
