'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { Badge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'
import { claimGroupAction } from '@/lib/actions/queue'
import { rsvpStatusLabel, rsvpStatusTone } from '@/lib/rsvp'
import { cn, formatDateTime } from '@/lib/utils'
import type { Database } from '@/lib/supabase/database.types'

export type QueueGroupRow = Database['public']['Views']['v_rsvp_queue']['Row']

export interface QueueRowProps {
  row: QueueGroupRow
  eventCode: string
}

/**
 * One family in the calling queue. The whole card is the tap target — always
 * tappable, locked or not, because `claim_group()` is re-entrant for its
 * current holder. The server decides whether the tap wins; this component
 * just relays the answer.
 */
export function QueueRow({ row, eventCode }: QueueRowProps) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [conflict, setConflict] = useState<string | null>(null)

  const groupId = row.group_id
  const headName = row.head_name?.trim() || 'Unnamed family'
  const pax = row.confirmed_pax ?? row.expected_pax ?? 0
  const status = row.rsvp_status ?? 'not_started'
  const attemptCount = row.attempt_count ?? 0
  const isLocked = row.is_locked ?? false
  const nextCallbackAt = row.next_callback_at

  async function handleTap() {
    if (!groupId || pending) return

    setConflict(null)
    setPending(true)

    const result = await claimGroupAction(groupId)

    if (result.ok) {
      router.push(`/${eventCode}/call/${groupId}`)
      return
    }

    setPending(false)
    setConflict(result.message)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={handleTap}
        disabled={!groupId || pending}
        aria-busy={pending || undefined}
        className={cn(
          'tap flex w-full items-center gap-3 rounded-2xl border bg-surface px-4 py-3.5 text-left transition-colors',
          'hover:bg-surface-2 active:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-70',
          isLocked ? 'border-warning' : 'border-border',
        )}
      >
        <div className="min-w-0 flex-1">
          <span className="block truncate text-base font-semibold text-fg">{headName}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted">
            <span>{pax} pax</span>
            <span>
              {attemptCount} {attemptCount === 1 ? 'attempt' : 'attempts'}
            </span>
            {nextCallbackAt ? <span>Callback {formatDateTime(nextCallbackAt)}</span> : null}
          </span>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Badge tone={rsvpStatusTone(status)}>{rsvpStatusLabel(status)}</Badge>
          {isLocked ? <Badge tone="warning">Locked</Badge> : null}
        </div>

        {pending ? <Spinner size="sm" label="Claiming" /> : null}
      </button>

      {conflict ? (
        <p role="alert" className="px-1 text-sm font-medium text-warning">
          {conflict}
        </p>
      ) : null}
    </div>
  )
}

export default QueueRow
