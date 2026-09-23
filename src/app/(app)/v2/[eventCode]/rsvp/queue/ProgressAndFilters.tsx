'use client'

import { Chip } from '@/components/ui/Chip'
import type { FilterChipId } from './types'

interface ProgressAndFiltersProps {
  totalCount: number
  calledCount: number
  comingCount: number
  callbackCount: number
  activeFilter: FilterChipId
  onFilterChange: (filter: FilterChipId) => void
}

const FILTER_CHIPS: { id: FilterChipId; label: string }[] = [
  { id: 'to_call', label: 'To call' },
  { id: 'callback', label: 'Call back' },
  { id: 'coming', label: 'Coming' },
  { id: 'not_coming', label: 'Not coming' },
  { id: 'all', label: 'All' },
]

export function ProgressAndFilters({
  totalCount,
  calledCount,
  comingCount,
  callbackCount,
  activeFilter,
  onFilterChange,
}: ProgressAndFiltersProps) {
  return (
    <div className="flex flex-col gap-2.5">
      {/* Progress line: "34 of 238 families called · 20 coming · 6 call back" */}
      <p className="text-sm font-medium text-muted">
        <span className="figure font-semibold text-ink">{calledCount}</span> of{' '}
        <span className="figure font-semibold text-ink">{totalCount}</span> families called
        {' · '}
        <span className="figure font-semibold text-ledger-green">{comingCount}</span> coming
        {' · '}
        <span className="figure font-semibold text-brand">{callbackCount}</span> call back
      </p>

      {/*
        Filter chips: To call | Call back | Coming | Not coming | All

        WRAPPING, not a horizontal scroller. The five chips are 67–106px wide
        with 32px of padding each, so three fit on the first line of a 360px
        handset and the remaining two fall to a second — every label reads
        whole. The row used to be `overflow-x-auto -mx-4 px-4`, which put
        "Not coming" past the right edge with nothing to show it could be
        scrolled: the last chip read "Not comin" and looked like a bug. A
        scroller would still need a fade and scroll-snap to be discoverable,
        and would still hide a filter from someone who never swipes. Wrapping
        costs 48px of height and hides nothing.
      */}
      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Filter queue"
      >
        {FILTER_CHIPS.map((chip) => (
          <Chip
            key={chip.id}
            selected={activeFilter === chip.id}
            onClick={() => onFilterChange(chip.id)}
            tone={activeFilter === chip.id ? 'active' : 'neutral'}
          >
            {chip.label}
          </Chip>
        ))}
      </div>
    </div>
  )
}
