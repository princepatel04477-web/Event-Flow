'use client'

import type { SubSide } from '@/lib/import/normalize'
import { cn } from '@/lib/utils'

export type ImportPrimarySide = 'groom' | 'bride'

export interface SideBifurcationSelectorProps {
  side: ImportPrimarySide | null
  subSide: SubSide | null
  onChange: (nextSide: ImportPrimarySide | null, nextSubSide: SubSide | null) => void
  /** Optional heading shown above the 2 primary side buttons. */
  title?: string
  /** Optional helper copy explaining how the selection applies to the file. */
  description?: string
  /** Compact padding for inline placement inside PreviewStep. */
  compact?: boolean
}

const PRIMARY_OPTIONS: Array<{ value: ImportPrimarySide; label: string; hint: string }> = [
  { value: 'groom', label: 'Groom Side', hint: 'Dulha family & friends' },
  { value: 'bride', label: 'Bride Side', hint: 'Dulhan family & friends' },
]

function branchOptionsFor(side: ImportPrimarySide): Array<{
  value: SubSide | null
  label: string
  hint: string
}> {
  const owner = side === 'groom' ? "Groom's" : "Bride's"
  return [
    { value: 'father', label: `${owner} Father Side`, hint: 'Paternal family' },
    { value: 'mother', label: `${owner} Mother Side`, hint: 'Maternal family' },
    { value: null, label: `General ${side === 'groom' ? 'Groom' : 'Bride'} Side`, hint: 'Not split by parent' },
  ]
}

export function SideBifurcationSelector({
  side,
  subSide,
  onChange,
  title = '1. Which side is this list for?',
  description = 'Choose Groom Side or Bride Side, and bifurcate by Father’s or Mother’s side.',
  compact = false,
}: SideBifurcationSelectorProps) {
  function handlePrimaryClick(selected: ImportPrimarySide) {
    if (side === selected) {
      // Allow toggling off if they want auto-detection from file columns only.
      onChange(null, null)
      return
    }
    onChange(selected, subSide)
  }

  function handleBranchClick(selectedSub: SubSide | null) {
    if (!side) return
    onChange(side, selectedSub)
  }

  const branchOptions = side ? branchOptionsFor(side) : null

  return (
    <div
      className={cn(
        'w-full rounded-xl border border-border bg-surface-2/60 text-left',
        compact ? 'p-3.5' : 'p-4',
      )}
    >
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-semibold text-fg">{title}</p>
        {description ? <p className="text-xs text-muted">{description}</p> : null}
      </div>

      {/* Primary 2-way bifurcation: Groom Side vs Bride Side */}
      <div
        role="group"
        aria-label="Primary wedding side"
        className="mt-3 grid grid-cols-2 gap-2.5"
      >
        {PRIMARY_OPTIONS.map((opt) => {
          const active = side === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={active}
              onClick={() => handlePrimaryClick(opt.value)}
              className={cn(
                'tap flex min-h-[3.25rem] flex-col items-start justify-center rounded-xl border px-3.5 py-2.5 text-left transition-colors',
                active
                  ? 'border-brand bg-brand-tint text-fg'
                  : 'border-border bg-paper text-fg hover:bg-surface-2',
              )}
            >
              <span className={cn('text-sm font-semibold', active && 'text-brand')}>
                {opt.label}
              </span>
              <span className="text-[0.7rem] text-muted">{opt.hint}</span>
            </button>
          )
        })}
      </div>

      {/* Sub-side bifurcation: Father's Side vs Mother's Side */}
      {side && branchOptions ? (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-xs font-medium text-muted">
            Bifurcate {side === 'groom' ? 'Groom Side' : 'Bride Side'} further
          </p>
          <div
            role="group"
            aria-label={`${side === 'groom' ? 'Groom' : 'Bride'} sub-side bifurcation`}
            className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3"
          >
            {branchOptions.map((opt) => {
              const active = subSide === opt.value
              return (
                <button
                  key={opt.value ?? 'general'}
                  type="button"
                  aria-pressed={active}
                  onClick={() => handleBranchClick(opt.value)}
                  className={cn(
                    'tap flex flex-col items-start justify-center rounded-lg border px-3 py-2 text-left transition-colors',
                    active
                      ? 'border-brand bg-brand-tint text-fg'
                      : 'border-border bg-paper text-fg hover:bg-surface-2',
                  )}
                >
                  <span className={cn('text-xs font-semibold', active && 'text-brand')}>
                    {opt.label}
                  </span>
                  <span className="text-[0.68rem] text-muted">{opt.hint}</span>
                </button>
              )
            })}
          </div>
        </div>
      ) : (
        <p className="mt-2.5 text-[0.7rem] text-subtle">
          Optional here: select Groom Side or Bride Side above to tag the entire file, or let columns
          in your sheet assign it per row.
        </p>
      )}
    </div>
  )
}

export default SideBifurcationSelector
