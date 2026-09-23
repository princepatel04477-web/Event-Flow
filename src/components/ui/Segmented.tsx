'use client'

import { cn } from '@/lib/utils'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  /** A count shown after the label in mono — "Waiting (14)". */
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
 * A switch between two views of the SAME list. Exactly one side is on and
 * there is no "neither".
 *
 * NOT A CHIP ROW, deliberately. Chips are filters — several can be on, and
 * turning them all off is a meaningful state. Giving the two behaviours the
 * same shape is how a filter row starts getting tapped like a switch and a
 * screen ends up showing everything because nothing is selected.
 *
 * TWO OPTIONS MAXIMUM (v3 rule). A third segment squeezes each label under
 * the width of its own text at 360px, and there is always a better answer:
 * two segments plus a sheet, or a section that stops trying to be two
 * screens. `options` is typed to allow more only because arrays are; the
 * caller owns the rule.
 *
 * `role="tablist"`, not a radio group: the panel below changes wholesale.
 * 48px tall so it clears a thumb.
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
        'flex w-full gap-1 rounded-xl border border-rule bg-surface-2 p-1',
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
              'tap min-h-12 min-w-0 flex-1 rounded-lg px-3 text-sm font-semibold leading-none',
              'transition-colors duration-press ease-ledger',
              selected
                ? 'bg-surface text-brand shadow-e1'
                : 'bg-transparent text-muted active:bg-surface',
            )}
          >
            <span className="truncate">{option.label}</span>
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
