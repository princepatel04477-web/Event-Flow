'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { PhoneIcon } from '@/components/icons'
import { Badge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'
import { StatusPill } from '@/components/ui/StatusPill'
import { claimGroupAction } from '@/lib/actions/queue'
import { rsvpStatusLabel } from '@/lib/rsvp'
import { statusTone, type StatusTone } from '@/lib/status'
import { cn, formatDateTime } from '@/lib/utils'
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
 * The whole card is the tap target — always tappable, locked or not,
 * because `claim_group()` is re-entrant for its current holder. The server
 * decides whether the tap wins; this component just relays the answer.
 *
 * The call button inside it is deliberately a second, smaller target on the
 * same destination rather than a `tel:` shortcut: the row must write a
 * `call_attempts` row BEFORE the dialer backgrounds the WebView (see the
 * call screen), so there is no path from this list straight to the phone
 * app. What it buys is a thumb-sized affordance that says "this row is a
 * phone call" without the caller having to know the whole card is live.
 */
export function QueueRow({ row, eventCode }: QueueRowProps) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [conflict, setConflict] = useState<string | null>(null)

  const groupId = row.group_id
  const headName = row.head_name?.trim() || 'Unnamed family'
  const mobile = row.primary_mobile?.trim() || null
  const side = row.side?.trim() || null
  const pax = row.confirmed_pax ?? row.expected_pax ?? 0
  const status = row.rsvp_status ?? 'not_started'
  const attemptCount = row.attempt_count ?? 0
  const isLocked = row.is_locked ?? false
  const nextCallbackAt = row.next_callback_at

  const edge = EDGE_TONES[status] ?? 'neutral'
  const disabled = !groupId || pending

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
            {/* Sans, not the display serif — these names arrive in
                Devanagari off the sheet and Cormorant has no Devanagari. */}
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

        {/* Secondary facts get their own ruled line so the chip row above
            keeps the same height on every card in the register. */}
        {isLocked || nextCallbackAt ? (
          <div className="mt-2.5 flex flex-wrap gap-x-3 border-t border-rule pt-2.5 font-mono text-xs text-brand">
            {isLocked ? <span>Locked by another caller</span> : null}
            {nextCallbackAt ? (
              <span>Callback {formatDateTime(nextCallbackAt)}</span>
            ) : null}
          </div>
        ) : null}
      </button>

      {conflict ? (
        <p
          role="alert"
          className="border-t border-ledger-red/25 bg-red-tint px-3.5 py-2.5 text-sm font-medium text-ledger-red"
        >
          {conflict}
        </p>
      ) : null}
    </div>
  )
}

export default QueueRow
