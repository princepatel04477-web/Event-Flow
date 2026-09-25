'use client'

import { PhoneIcon } from '@/components/icons'
import { Button } from '@/components/ui/Button'
import { StatusPill } from '@/components/ui/StatusPill'
import type { LockNote } from '@/lib/lock'
import { dialTarget } from '@/lib/native-call'
import { SIDE_LABELS } from '@/lib/review/payload'
import { rsvpStatusLabel } from '@/lib/rsvp'
import { statusTone } from '@/lib/status'
import { cn, formatDateTime } from '@/lib/utils'

import type { QueueRow, Side } from './types'

interface CurrentFamilyCardProps {
  row: QueueRow
  dialling: boolean
  lock: LockNote | null
  onCall: () => void
}

function relationLabel(groupType: string | null): string | null {
  if (!groupType) return null
  switch (groupType.toLowerCase()) {
    case 'family':
      return 'Family'
    case 'couple':
      return 'Couple'
    case 'single':
      return 'Single'
    case 'friends':
      return 'Friends'
    default:
      return groupType.charAt(0).toUpperCase() + groupType.slice(1)
  }
}

export function CurrentFamilyCard({
  row,
  dialling,
  lock,
  onCall,
}: CurrentFamilyCardProps) {
  const headName = row.head_name?.trim() || 'Unnamed family'
  const expectedPax = row.expected_pax ?? row.confirmed_pax ?? 0
  const attempts = row.attempt_count ?? 0
  const callback = row.next_callback_at
  const canDial = dialTarget(row.primary_mobile) !== null
  const relation = relationLabel(row.group_type)
  const sideLabel = row.side ? (SIDE_LABELS[row.side as Side] ?? row.side) : null

  const metaLine = [
    relation,
    sideLabel,
    `${expectedPax} invited`,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <section
      className="flex flex-col gap-3 rounded-2xl border border-rule bg-surface p-4 shadow-e1"
      aria-label={`Current family: ${headName}`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="line-clamp-2 text-xl leading-tight font-semibold break-words text-ink font-display">
            {headName}
          </h2>
          {/*
            The family's calling status, ON the call screen. It was only ever
            rendered inside the "all families" sheet, so logging an outcome
            changed nothing the caller could see without opening that sheet -
            which is how "the status does not update" got reported. The queue
            row is patched optimistically before the write leaves the phone,
            so this pill flips on the tap.
          */}
          <div className="mt-1.5">
            <StatusPill tone={statusTone(row.rsvp_status)}>
              {rsvpStatusLabel(row.rsvp_status)}
            </StatusPill>
          </div>
          <p className="mt-1 text-sm text-muted">{metaLine}</p>
          {attempts > 0 ? (
            <p className="mt-0.5 text-xs text-subtle">
              {attempts} {attempts === 1 ? 'call' : 'calls'} so far
            </p>
          ) : null}
        </div>

        <Button
          variant="success"
          size="sm"
          disabled={!canDial || dialling}
          leadingIcon={<PhoneIcon className="h-5 w-5" aria-hidden />}
          onClick={onCall}
          className="shrink-0"
          aria-label={`Call ${headName}`}
        >
          {dialling ? 'Calling…' : 'Call'}
        </Button>
      </div>

      {callback ? (
        <p className="text-sm font-medium text-ledger-amber">
          Call back {formatDateTime(callback)}
        </p>
      ) : null}

      {lock ? (
        <p
          className={cn(
            'rounded-xl px-3 py-2 text-sm leading-snug',
            lock.locked ? 'bg-brand-tint text-ink' : 'bg-surface-2 text-muted',
          )}
        >
          {lock.sentence}
        </p>
      ) : null}

      {!canDial ? (
        <p className="text-xs text-muted">No phone number on file for this family.</p>
      ) : null}
    </section>
  )
}
