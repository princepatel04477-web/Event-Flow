'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { PhoneIcon } from '@/components/icons'
import { Badge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'
import { StatusPill } from '@/components/ui/StatusPill'
import { rsvpStatusLabel } from '@/lib/rsvp'
import { statusTone, type StatusTone } from '@/lib/status'
import { cn } from '@/lib/utils'
import type { Database } from '@/lib/supabase/database.types'

export type QueueGroupRow = Database['public']['Views']['v_rsvp_queue']['Row']

export interface QueueRowProps {
  row: QueueGroupRow
  eventCode: string
}

/**
 * The leading-edge rule. Only the two ends of the funnel earn a colour:
 * confirmed (done with) and unreachable/declined (a live gap). Everything
 * in between is work in progress and gets the neutral rule — if four of
 * seven statuses light up the edge, the edge has stopped saying anything.
 */
const EDGE_TONES: Record<string, StatusTone> = {
  confirmed: 'done',
  declined: 'attention',
  unreachable: 'attention',
}

/**
 * One family in the calling queue.
 *
 * Always tappable — the caller lock is dormant as of 2026-08-12.
 * Tapping navigates directly to the call screen with no RPC, no
 * await, and no lock gate. Two handsets can open the same family
 * simultaneously.
 */
export function QueueRow({ row, eventCode }: QueueRowProps) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  const groupId = row.group_id
  const headName = row.head_name?.trim() || 'Unnamed family'
  const mobile = row.primary_mobile?.trim() || null
  const side = row.side?.trim() || null
  const pax = row.confirmed_pax ?? row.expected_pax ?? 0
  const status = row.rsvp_status ?? 'not_started'
  const attemptCount = row.attempt_count ?? 0
  const nextCallbackAt = row.next_callback_at

  const edge = EDGE_TONES[status] ?? 'neutral'
  const disabled = !groupId || pending

  // Presence signal: when staff opened this group within the last 15 min.
  // guest_groups columns added by migration 20260812000000_presence_columns.
  const lastOpenedBy = (row as Record<string, unknown>).last_opened_by_staff as string | null
  const lastOpenedAt = (row as Record<string, unknown>).last_opened_at as string | null
  const openedRecently =
    lastOpenedAt != null &&
    new Date(lastOpenedAt).getTime() > Date.now() - 15 * 60_000

  // Resolve the staff name from the view's own joined column
  const lastOpenedByName = (row as Record<string, unknown>).last_opened_by_name as string | undefined

  function handleTap() {
    if (!groupId || pending) return
    setPending(true)
    router.push(`/${eventCode}/rsvp/call/${groupId}`)
  }

  return (
    <div
      className={cn(
        'list-fade overflow-hidden rounded-xl border border-rule bg-surface',
        edge === 'done' && 'border-l-[3px] border-l-ledger-green',
        edge === 'attention' && 'border-l-[3px] border-l-ledger-red',
        edge === 'neutral' && 'border-l-[3px] border-l-rule-strong',
        disabled && pending && 'opacity-70',
      )}
    >
      <button
        type="button"
        onClick={handleTap}
        disabled={disabled}
        aria-busy={pending || undefined}
        className="tap w-full px-3.5 py-3.5 text-left transition-colors duration-press ease-ledger active:bg-surface-2 disabled:cursor-not-allowed"
      >
        <div className="flex items-start justify-between gap-2.5">
          <div className="min-w-0">
            <span className="block text-lg leading-snug font-medium text-ink">
              {headName}
            </span>
            {mobile ? (
              <span className="mt-0.5 block font-mono text-sm text-muted tabular-nums">
                {mobile}
              </span>
            ) : null}
          </div>

          <span
            aria-hidden
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-brand/45 bg-brand-tint text-brand"
          >
            {pending ? <Spinner size="sm" label={null} /> : <PhoneIcon className="h-5 w-5" />}
          </span>
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {side ? <Badge>{side}</Badge> : null}
          <span className="figure text-sm text-ink">{pax} pax</span>
          <span className="figure text-sm text-muted">
            · {attemptCount} {attemptCount === 1 ? 'attempt' : 'attempts'}
          </span>
          <StatusPill tone={statusTone(status)} className="ml-auto">
            {rsvpStatusLabel(status)}
          </StatusPill>
        </div>

        {/* Secondary facts */}
        {openedRecently || nextCallbackAt ? (
          <div className="mt-2.5 flex flex-wrap gap-x-3 border-t border-rule pt-2.5 font-mono text-xs">
            {openedRecently && lastOpenedByName ? (
              <span className="text-muted">
                {lastOpenedByName}, {relativeTimeLabel(lastOpenedAt!)}
              </span>
            ) : null}
            {nextCallbackAt ? (
              <span className="text-brand">
                Callback {formatRelativeDateTime(nextCallbackAt)}
              </span>
            ) : null}
          </div>
        ) : null}
      </button>
    </div>
  )
}

function formatRelativeDateTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = d.getTime() - now.getTime()
  const diffMin = Math.round(diffMs / 60_000)
  if (diffMin <= 0) return 'now'
  if (diffMin < 60) return `${diffMin}m`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h`
  return `${Math.round(diffHr / 24)}d`
}

function relativeTimeLabel(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const diffSec = Math.round(diffMs / 1000)
  if (diffSec < 60) return 'just now'
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin} min ago`
  return 'earlier'
}

export default QueueRow
