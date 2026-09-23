'use client'

import { ClockIcon, PhoneIcon } from '@/components/icons'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { StatusPill } from '@/components/ui/StatusPill'
import type { LockNote } from '@/lib/lock'
import { dialTarget } from '@/lib/native-call'
import { formatMobile } from '@/lib/phone'
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
  const mobile = row.primary_mobile?.trim() || null
  const expectedPax = row.expected_pax ?? row.confirmed_pax ?? 0
  const status = row.rsvp_status ?? 'not_started'
  const attempts = row.attempt_count ?? 0
  const callback = row.next_callback_at
  const canDial = dialTarget(mobile) !== null

  // The button names the family the way the list does: the head's full display
  // name, never a shortened form. A long name is ellipsised by CSS, not cut by
  // string slicing, so "0 V12-Call Next" reads whole and the DOM keeps the rest.
  const relation = relationLabel(row.group_type)

  return (
    <section
      className="flex flex-col gap-3 rounded-2xl border border-rule-strong bg-surface p-4 shadow-e1"
      aria-label={`Current family: ${headName}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/*
            Long names are evidence, not decoration, but they must not break
            the layout. `break-words` (overflow-wrap: break-word) lets a
            machine-made token like "E2E-PROOF-msin37ga" break at the hyphen
            rather than run past the card, and `line-clamp-2` caps the block at
            two lines with an ellipsis so a genuinely enormous name cannot push
            the phone number and the Call button off the screen. The full string
            stays in the DOM and in `aria-label` on the section below, so the
            clamp is presentational: nothing is cut for a screen reader, and the
            button that names the family is unchanged.
          */}
          <h2 className="line-clamp-2 text-xl leading-tight font-semibold break-words text-ink">
            {headName}
          </h2>
          {mobile ? (
            <p className="figure mt-1 text-base font-medium text-muted">
              {formatMobile(mobile)}
            </p>
          ) : (
            <p className="mt-1 text-base text-muted">No phone number on file</p>
          )}
        </div>
        <StatusPill tone={statusTone(status)}>{rsvpStatusLabel(status)}</StatusPill>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="figure font-medium text-ink">
          {expectedPax} {expectedPax === 1 ? 'guest' : 'guests'}
        </span>
        {row.side ? <Badge>{SIDE_LABELS[row.side as Side] ?? row.side}</Badge> : null}
        {relation ? <Badge tone="neutral">{relation}</Badge> : null}
        <span className="figure text-muted">
          · {attempts} {attempts === 1 ? 'attempt' : 'attempts'}
        </span>
      </div>

      {callback ? (
        <p className="flex items-center gap-1.5 text-sm font-medium text-brand">
          <ClockIcon className="h-4 w-4 shrink-0" aria-hidden />
          Asked to be called back {formatDateTime(callback)}
        </p>
      ) : null}

      {lock ? (
        <p
          className={cn(
            'flex items-start gap-2 rounded-lg px-3 py-2 text-sm leading-snug',
            lock.locked ? 'bg-brand-tint text-ink' : 'bg-surface-2 text-muted',
          )}
        >
          <ClockIcon className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
          <span>{lock.sentence}</span>
        </p>
      ) : null}

      {/* ONE filled primary button on this card: "Call <full name>". A name
          too long for the row is ellipsised by CSS, never by slicing. */}
      <Button
        variant="primary"
        size="lg"
        fullWidth
        disabled={!canDial}
        leadingIcon={<PhoneIcon className="h-5 w-5" aria-hidden />}
        onClick={onCall}
      >
        <span className="min-w-0 truncate">
          {dialling
            ? 'Logging the call…'
            : `Call ${headName}${lock?.locked ? ' anyway' : ''}`}
        </span>
      </Button>

      {!canDial ? (
        <p className="-mt-1.5 text-xs text-muted">
          No phone number to dial. Pick another family below or check with your lead.
        </p>
      ) : null}
    </section>
  )
}
