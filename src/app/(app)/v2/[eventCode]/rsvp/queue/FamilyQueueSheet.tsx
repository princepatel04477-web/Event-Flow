'use client'

import { BottomSheet } from '@/components/ui/BottomSheet'
import { Chip } from '@/components/ui/Chip'
import { Row } from '@/components/ui/Row'
import { initials } from '@/lib/ui/metrics'
import { rsvpStatusLabel } from '@/lib/rsvp'
import { FILTER_CHIPS, type FilterChipId } from '@/lib/rsvp-queue'
import { statusTone } from '@/lib/status'

import type { QueueRow } from './types'

function rowToneForStatus(status: string): 'neutral' | 'done' | 'waiting' | 'problem' {
  const tone = statusTone(status)
  if (tone === 'done') return 'done'
  if (tone === 'attention') return 'problem'
  if (tone === 'active') return 'waiting'
  return 'neutral'
}

/**
 * The status WORD on the right of a row.
 *
 * Deliberately the canonical vocabulary from `@/lib/status`, not a shortened
 * form. An earlier cut took the first word of the label, which turned
 * "Not started" into "Not" — a word that reads as the beginning of "Not
 * coming" and is the opposite of what the family's state actually is. The
 * CALLER'S words ("Coming", "No answer") belong on the outcome picker where
 * they are being chosen; a status column states the record.
 */
function statusWord(status: string): string {
  return rsvpStatusLabel(status)
}

export interface FamilyQueueSheetProps {
  open: boolean
  onClose: () => void
  rows: QueueRow[]
  currentGroupId: string | null
  activeFilter: FilterChipId
  /** How many families sit under each chip, computed over the WHOLE event. */
  counts: Record<FilterChipId, number>
  onFilterChange: (filter: FilterChipId) => void
  onSelectFamily: (groupId: string) => void
}

export function FamilyQueueSheet({
  open,
  onClose,
  rows,
  currentGroupId,
  activeFilter,
  counts,
  onFilterChange,
  onSelectFamily,
}: FamilyQueueSheetProps) {
  return (
    <BottomSheet open={open} onClose={onClose} label="All families">
      <div className="flex flex-col gap-4 pb-2">
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
              <span className="ml-1.5 tabular-nums font-normal opacity-70">
                {counts[chip.id]}
              </span>
            </Chip>
          ))}
        </div>

        <ul className="flex flex-col gap-1" role="list">
          {rows.map((row) => {
            if (!row.group_id) return null
            const name = row.head_name?.trim() || 'Unnamed family'
            const pax = row.confirmed_pax ?? row.expected_pax ?? 0
            const status = row.rsvp_status ?? 'not_started'
            const isCurrent = row.group_id === currentGroupId
            const metaParts = [
              pax > 0 ? `${pax} invited` : null,
              row.is_locked ? 'On another phone' : null,
              isCurrent ? 'Current' : null,
            ].filter(Boolean)

            return (
              <li key={row.group_id}>
                <Row
                  heading={name}
                  meta={metaParts.join(' · ') || undefined}
                  initials={initials(name)}
                  status={statusWord(status)}
                  tone={row.is_locked ? 'waiting' : rowToneForStatus(status)}
                  onPress={() => {
                    onSelectFamily(row.group_id as string)
                    onClose()
                  }}
                />
              </li>
            )
          })}
        </ul>
      </div>
    </BottomSheet>
  )
}
