'use client'

import { Select } from '@/components/ui/Select'
import { cn } from '@/lib/utils'
import type { QueueFilterState, RsvpStatus, Side } from './filters'

const STATUS_OPTIONS: { value: RsvpStatus; label: string }[] = [
  { value: 'not_started', label: 'Not started' },
  { value: 'attempted', label: 'Attempted' },
  { value: 'callback', label: 'Callback' },
  { value: 'tentative', label: 'Tentative' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'declined', label: 'Declined' },
  { value: 'unreachable', label: 'Unreachable' },
]

const SIDE_OPTIONS: { value: Side; label: string }[] = [
  { value: 'bride', label: 'Bride side' },
  { value: 'groom', label: 'Groom side' },
  { value: 'both', label: 'Both sides' },
  { value: 'other', label: 'Other' },
]

export interface QueueFiltersProps {
  filters: QueueFilterState
  onChange: (next: QueueFilterState) => void
}

const CHIP_BASE =
  'tap min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold transition-colors'
const CHIP_ACTIVE = 'border-transparent bg-brand text-brand-fg'
const CHIP_INACTIVE = 'border-border-strong bg-surface text-fg hover:bg-surface-2'

const TOGGLE_BASE =
  'tap min-h-11 flex-1 rounded-xl border px-3 text-sm font-semibold transition-colors'

/**
 * Filter bar for the calling queue. Deliberately dumb — it only reads the
 * `filters` prop and reports the next state up. The parent owns the URL
 * (`router.replace`), so a refresh survives.
 */
export function QueueFilters({ filters, onChange }: QueueFiltersProps) {
  function toggleStatus(value: RsvpStatus) {
    const active = filters.statuses.includes(value)
    onChange({
      ...filters,
      statuses: active
        ? filters.statuses.filter((status) => status !== value)
        : [...filters.statuses, value],
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
        role="group"
        aria-label="Filter by RSVP status"
      >
        {STATUS_OPTIONS.map((option) => {
          const active = filters.statuses.includes(option.value)
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => toggleStatus(option.value)}
              aria-pressed={active}
              className={cn(CHIP_BASE, active ? CHIP_ACTIVE : CHIP_INACTIVE)}
            >
              {option.label}
            </button>
          )
        })}
      </div>

      <Select
        label="Side"
        value={filters.side ?? ''}
        onChange={(event) => {
          const value = event.target.value
          onChange({ ...filters, side: value ? (value as Side) : null })
        }}
        placeholder="All sides"
        options={SIDE_OPTIONS}
      />

      <div className="flex gap-2">
        {/* "Callbacks due now" was a lie: v_rsvp_queue only ever exposes the
            next callback that is still in the FUTURE, so nothing overdue can
            appear here. Labelled for what it actually shows. */}
        <button
          type="button"
          onClick={() => onChange({ ...filters, callbackScheduled: !filters.callbackScheduled })}
          aria-pressed={filters.callbackScheduled}
          className={cn(TOGGLE_BASE, filters.callbackScheduled ? CHIP_ACTIVE : CHIP_INACTIVE)}
        >
          Callback booked
        </button>
        <button
          type="button"
          onClick={() => onChange({ ...filters, hideLocked: !filters.hideLocked })}
          aria-pressed={filters.hideLocked}
          className={cn(TOGGLE_BASE, filters.hideLocked ? CHIP_ACTIVE : CHIP_INACTIVE)}
        >
          Hide locked
        </button>
      </div>
    </div>
  )
}

export default QueueFilters
