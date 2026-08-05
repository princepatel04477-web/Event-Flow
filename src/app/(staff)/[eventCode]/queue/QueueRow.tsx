'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { Spinner } from '@/components/ui/Spinner'
import { ListRow } from '@/components/ui/ListRow'
import { StatusPill } from '@/components/ui/StatusPill'
import { claimGroupAction } from '@/lib/actions/queue'
import { rsvpStatusLabel } from '@/lib/rsvp'
import { statusTone } from '@/lib/status'
import { cn, formatDateTime } from '@/lib/utils'
import type { Database } from '@/lib/supabase/database.types'

export type QueueGroupRow = Database['public']['Views']['v_rsvp_queue']['Row']

export interface QueueRowProps {
  row: QueueGroupRow
  eventCode: string
}

/**
 * One family in the calling queue. The whole row is the tap target — always
 * tappable, locked or not, because `claim_group()` is re-entrant for its
 * current holder. The server decides whether the tap wins; this component
 * just relays the answer.
 *
 * The family name is the one thing on this row that matters, so it is the
 * display face at 18px — readable at arm's length by a caller with a phone
 * against one ear. The figures (pax, attempts, callback time) are tabular
 * mono so a column of them lines up.
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

  const meta = (
    <>
      <span>
        <span className="font-mono tabular-nums">{pax}</span> pax
      </span>
      {' · '}
      <span>
        <span className="font-mono tabular-nums">{attemptCount}</span>{' '}
        {attemptCount === 1 ? 'attempt' : 'attempts'}
      </span>
      {isLocked ? <span> · Locked</span> : null}
      {nextCallbackAt ? (
        <span> · Callback {formatDateTime(nextCallbackAt)}</span>
      ) : null}
    </>
  )

  return (
    <div className="flex flex-col gap-1.5">
      <ListRow
        identifier={headName}
        meta={meta}
        right={
          <StatusPill tone={statusTone(status)}>{rsvpStatusLabel(status)}</StatusPill>
        }
        onPress={handleTap}
        disabled={!groupId || pending}
        aria-busy={pending || undefined}
      >
        {pending ? <Spinner size="sm" label="Claiming" /> : null}
      </ListRow>

      {conflict ? (
        <p role="alert" className={cn('px-1 text-sm font-medium text-muted')}>
          {conflict}
        </p>
      ) : null}
    </div>
  )
}

export default QueueRow
