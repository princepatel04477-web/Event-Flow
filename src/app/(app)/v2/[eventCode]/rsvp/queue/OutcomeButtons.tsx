'use client'

import { cn } from '@/lib/utils'
import type { OutcomeStatus } from './types'

interface OutcomeButtonsProps {
  activeOutcome: OutcomeStatus | null
  onSelectOutcome: (status: OutcomeStatus) => void
  disabled?: boolean
}

export function OutcomeButtons({
  activeOutcome,
  onSelectOutcome,
  disabled = false,
}: OutcomeButtonsProps) {
  return (
    <section className="flex flex-col gap-2.5" aria-labelledby="outcome-heading">
      <h3 id="outcome-heading" className="eyebrow">
        What happened on the call?
      </h3>

      {/* Neutral segmented buttons: neutral border, neutral background, no harsh red/pink */}
      <div className="grid grid-cols-6 gap-2" role="group" aria-label="Log call outcome">
        {/* Row 1: Coming (cols 1-3) and Maybe (cols 4-6) */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSelectOutcome('confirmed')}
          className={cn(
            'tap col-span-3 flex min-h-12 items-center justify-center rounded-xl border px-3 text-base font-semibold',
            'transition-[background-color,border-color,color] duration-press ease-ledger',
            activeOutcome === 'confirmed'
              ? 'border-brand bg-brand-tint text-brand ring-2 ring-brand/30'
              : 'border-rule-strong bg-surface text-ink hover:bg-surface-2 active:bg-surface-2',
            disabled && 'opacity-55 cursor-not-allowed',
          )}
        >
          Coming
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={() => onSelectOutcome('tentative')}
          className={cn(
            'tap col-span-3 flex min-h-12 items-center justify-center rounded-xl border px-3 text-base font-semibold',
            'transition-[background-color,border-color,color] duration-press ease-ledger',
            activeOutcome === 'tentative'
              ? 'border-brand bg-brand-tint text-brand ring-2 ring-brand/30'
              : 'border-rule-strong bg-surface text-ink hover:bg-surface-2 active:bg-surface-2',
            disabled && 'opacity-55 cursor-not-allowed',
          )}
        >
          Maybe
        </button>

        {/* Row 2: Call back (cols 1-2), No answer (cols 3-4), Not coming (cols 5-6) */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSelectOutcome('callback')}
          className={cn(
            'tap col-span-2 flex min-h-12 items-center justify-center rounded-xl border px-2 text-sm font-semibold',
            'transition-[background-color,border-color,color] duration-press ease-ledger',
            activeOutcome === 'callback'
              ? 'border-brand bg-brand-tint text-brand ring-2 ring-brand/30'
              : 'border-rule-strong bg-surface text-ink hover:bg-surface-2 active:bg-surface-2',
            disabled && 'opacity-55 cursor-not-allowed',
          )}
        >
          Call back
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={() => onSelectOutcome('unreachable')}
          className={cn(
            'tap col-span-2 flex min-h-12 items-center justify-center rounded-xl border px-2 text-sm font-semibold',
            'transition-[background-color,border-color,color] duration-press ease-ledger',
            activeOutcome === 'unreachable'
              ? 'border-ink bg-surface-2 text-ink ring-2 ring-ink/20'
              : 'border-rule-strong bg-surface text-ink hover:bg-surface-2 active:bg-surface-2',
            disabled && 'opacity-55 cursor-not-allowed',
          )}
        >
          No answer
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={() => onSelectOutcome('declined')}
          className={cn(
            'tap col-span-2 flex min-h-12 items-center justify-center rounded-xl border px-2 text-sm font-semibold',
            'transition-[background-color,border-color,color] duration-press ease-ledger',
            activeOutcome === 'declined'
              ? 'border-ink bg-surface-2 text-ink ring-2 ring-ink/20'
              : 'border-rule-strong bg-surface text-ink hover:bg-surface-2 active:bg-surface-2',
            disabled && 'opacity-55 cursor-not-allowed',
          )}
        >
          Not coming
        </button>
      </div>
    </section>
  )
}
