'use client'

import { ListRow } from '@/components/ui/ListRow'
import { StatusPill } from '@/components/ui/StatusPill'
import { rsvpStatusLabel } from '@/lib/rsvp'
import { statusTone } from '@/lib/status'
import { cn } from '@/lib/utils'

import type { QueueRow } from './types'

interface FamilyQueueListProps {
  rows: QueueRow[]
  currentGroupId: string | null
  onSelectFamily: (groupId: string) => void
  lockedCount: number
}

const LIST_LIMIT = 25

export function FamilyQueueList({
  rows,
  currentGroupId,
  onSelectFamily,
  lockedCount,
}: FamilyQueueListProps) {
  const displayedRows = rows.slice(0, LIST_LIMIT)

  return (
    <section
      className="flex flex-col gap-2.5 pb-16"
      aria-labelledby="family-list-heading"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="family-list-heading" className="eyebrow">
          In this list ({rows.length})
        </h3>
        {lockedCount > 0 ? (
          <span className="text-xs text-muted">
            {lockedCount === 1
              ? '1 family open on another phone'
              : `${lockedCount} families open on another phone`}
          </span>
        ) : null}
      </div>

      <ul className="flex flex-col gap-2" role="list">
        {displayedRows.map((row) => {
          if (!row.group_id) return null
          const isCurrent = row.group_id === currentGroupId
          const name = row.head_name?.trim() || 'Unnamed family'
          const pax = row.confirmed_pax ?? row.expected_pax ?? 0
          const status = row.rsvp_status ?? 'not_started'
          const isLocked = row.is_locked === true

          return (
            <li
              key={row.group_id}
              className={cn(
                'rounded-xl border bg-surface transition-[background-color,border-color] duration-press ease-ledger',
                isCurrent
                  ? 'border-l-4 border-l-brand border-brand/50 bg-brand-tint/20 ring-1 ring-brand/30'
                  : isLocked
                    ? 'border-brand/35'
                    : 'border-rule hover:border-rule-strong',
              )}
            >
              <ListRow
                identifier={name}
                meta={[
                  pax > 0 ? `${pax} ${pax === 1 ? 'guest' : 'guests'}` : 'Guests unrecorded',
                  row.side ? capitalize(row.side) : null,
                  isLocked ? 'Open on another phone' : null,
                  isCurrent ? 'Current' : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                right={
                  isLocked ? (
                    <StatusPill tone="active">In progress</StatusPill>
                  ) : (
                    <StatusPill tone={statusTone(status)}>{rsvpStatusLabel(status)}</StatusPill>
                  )
                }
                onPress={() => onSelectFamily(row.group_id as string)}
              />
            </li>
          )
        })}
      </ul>

      {rows.length > LIST_LIMIT ? (
        <p className="text-center text-xs text-muted pt-1">
          Showing first {LIST_LIMIT} of {rows.length} families. Use the filters above to narrow.
        </p>
      ) : null}
    </section>
  )
}

function capitalize(s: string): string {
  if (!s) return ''
  return s.charAt(0).toUpperCase() + s.slice(1)
}
