'use client'

import { cn } from '@/lib/utils'

interface OutcomeButtonsProps {
  activeOutcome: 'confirmed' | null
  onSelectComing: () => void
  onSelectNotComing: () => void
  onSelectNoAnswer: () => void
  onOpenAlternate: () => void
  disabled?: boolean
}

export function OutcomeButtons({
  activeOutcome,
  onSelectComing,
  onSelectNotComing,
  onSelectNoAnswer,
  onOpenAlternate,
  disabled = false,
}: OutcomeButtonsProps) {
  return (
    <section className="flex flex-col gap-2.5" aria-labelledby="outcome-heading">
      <h3 id="outcome-heading" className="text-sm font-medium text-muted">
        What happened?
      </h3>

      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Log call outcome">
        <button
          type="button"
          disabled={disabled}
          onClick={onSelectComing}
          className={cn(
            'tap flex min-h-12 items-center justify-center rounded-row border px-2 text-sm font-semibold',
            activeOutcome === 'confirmed'
              ? 'border-brand bg-brand-tint text-brand'
              : 'border-rule-strong bg-surface text-ink active:bg-surface-2',
            disabled && 'cursor-not-allowed opacity-55',
          )}
        >
          Coming
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={onSelectNotComing}
          className={cn(
            'tap flex min-h-12 items-center justify-center rounded-row border px-2 text-sm font-semibold',
            'border-rule-strong bg-surface text-ink active:bg-surface-2',
            disabled && 'cursor-not-allowed opacity-55',
          )}
        >
          Not coming
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={onSelectNoAnswer}
          className={cn(
            'tap flex min-h-12 items-center justify-center rounded-row border px-2 text-sm font-semibold',
            'border-rule-strong bg-surface text-ink active:bg-surface-2',
            disabled && 'cursor-not-allowed opacity-55',
          )}
        >
          No answer
        </button>
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={onOpenAlternate}
        className="tap min-h-11 self-start text-sm font-medium text-brand underline-offset-2 hover:underline active:text-brand-hover disabled:opacity-55"
      >
        Call back later or Maybe
      </button>
    </section>
  )
}
