'use client'

import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { LinkButton } from '@/components/ui/LinkButton'
import { Progress } from '@/components/ui/Progress'
import {
  type CampaignRow,
  setCampaignStatus,
  startCampaign,
} from '@/lib/actions/campaigns'
import { dialNextCampaignJob } from '@/lib/actions/outbound'
import { formatCount } from '@/lib/utils'
import { GrokTestCall } from '@/components/rsvp/GrokTestCall'
import { PhoneIcon } from '@/components/icons'

const ROUND_NAMES: Record<string, string> = {
  wave_1: 'Round 1 — one month before',
  wave_2: 'Round 2 — ten days before',
  wave_3: 'Round 3 — two days before',
}

function roundLabel(c: CampaignRow): string {
  return ROUND_NAMES[c.wave] ?? c.label
}

/**
 * The auto-calling board.
 *
 * RESTYLED, NOT REDESIGNED: the same `ensureCampaigns` rows, the same
 * `startCampaign` / `dialNextCampaignJob` / `setCampaignStatus` transitions.
 *
 * WHAT LEFT. The stacked eyebrow + title (`SectionHead`) — the shell's header
 * already names this screen "Auto-call", so the body was repeating it. The
 * two-button hero card is now one figure with two secondary ways in, which
 * leaves the screen's single maroon primary where the work actually is: the
 * running round.
 */
export function CampaignBoard({
  eventId,
  eventCode,
  campaigns,
  guestCount,
  staffCount,
  grokConfigured,
}: {
  eventId: string
  eventCode: string
  campaigns: CampaignRow[]
  guestCount: number
  staffCount: number
  grokConfigured: boolean
}) {
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const totalFamilies = guestCount
  const confirmed = campaigns.reduce((sum, c) => sum + c.completed, 0)
  const activeRound =
    campaigns.find((c) => c.status === 'running') ??
    campaigns.find((c) => c.status === 'draft' || c.status === 'paused')

  function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    if (pending) return
    setError(null)
    setNotice(null)
    startTransition(async () => {
      const res = await fn()
      if (!res.ok) setError(res.error ?? 'Something went wrong. Try again.')
      else if (res.message) setNotice(res.message)
    })
  }

  if (guestCount === 0) {
    return (
      <div className="flex flex-col gap-4 pb-nav">
        <EmptyState
          icon={<PhoneIcon className="h-7 w-7" />}
          title="No families to call yet"
          description="Import the guest list first."
          action={
            <LinkButton href={`/${eventCode}/guests/import`} fullWidth>
              Import guest list
            </LinkButton>
          }
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 pb-nav">
      {/* THE FIGURE. One number, then the two ways a human can help. */}
      <section className="flex flex-col gap-3 rounded-2xl border border-rule bg-surface p-4 shadow-e1">
        <div>
          <p className="figure font-display text-3xl leading-none font-semibold text-ink">
            {formatCount(totalFamilies)}
          </p>
          <p className="mt-1 text-sm text-muted">
            families to call
            {confirmed > 0 ? ` · ${formatCount(confirmed)} done across rounds` : ''}
          </p>
        </div>
        <div className="flex items-stretch gap-2.5">
          <div className="min-w-0 flex-1">
            <LinkButton
              href={`/${eventCode}/rsvp/queue`}
              variant="secondary"
              fullWidth
              className="min-w-0"
            >
              Call by hand
            </LinkButton>
          </div>
          <div className="min-w-0 flex-1">
            <LinkButton
              href={`/${eventCode}/rsvp/review`}
              variant="secondary"
              fullWidth
              className="min-w-0"
            >
              Review notes
            </LinkButton>
          </div>
        </div>
      </section>

      {staffCount === 0 ? (
        <p className="rounded-xl border border-ledger-amber/40 bg-amber-tint px-3.5 py-3 text-sm font-medium text-ledger-amber">
          Add staff names in admin so callers can pick their name at login.
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-ledger-red/40 bg-red-tint px-3.5 py-3 text-sm font-medium text-ledger-red"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-xl border border-rule bg-surface-2 px-3.5 py-3 text-sm text-ink">
          {notice}
        </p>
      ) : null}

      {activeRound ? (
        <section className="flex flex-col gap-3 rounded-2xl border border-rule bg-surface p-4">
          <h2 className="font-display text-lg font-semibold text-ink">{roundLabel(activeRound)}</h2>

          {activeRound.total > 0 ? (
            <Progress
              label="Called in this round"
              done={activeRound.completed}
              total={activeRound.total}
              tone="green"
            />
          ) : (
            <p className="text-sm text-muted">Not started — build the list first.</p>
          )}

          {activeRound.status === 'draft' || activeRound.status === 'paused' ? (
            <Button
              size="lg"
              fullWidth
              loading={pending}
              onClick={() => run(() => startCampaign(activeRound.id, eventId, eventCode))}
            >
              {activeRound.status === 'paused' ? 'Resume calling' : 'Start calling'}
            </Button>
          ) : null}

          {activeRound.status === 'running' ? (
            <div className="flex flex-col gap-2.5">
              <Button
                size="lg"
                fullWidth
                loading={pending}
                onClick={() => run(() => dialNextCampaignJob(activeRound.id, eventId, eventCode))}
              >
                Call the next family
              </Button>
              <Button
                variant="secondary"
                fullWidth
                loading={pending}
                onClick={() =>
                  run(() => setCampaignStatus(activeRound.id, eventId, eventCode, 'paused'))
                }
              >
                Pause
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      {campaigns.length > 1 ? (
        <details className="rounded-2xl border border-rule bg-surface px-4 py-2">
          <summary className="tap min-h-11 cursor-pointer text-sm font-medium text-ink">
            All rounds ({campaigns.length})
          </summary>
          <ul className="mt-1 flex flex-col gap-2 pb-2" role="list">
            {campaigns.map((c) => (
              <li key={c.id} className="text-sm text-muted">
                <span className="font-medium text-ink">{roundLabel(c)}</span>
                {' — '}
                {formatCount(c.completed)} done
                {c.total > 0 ? ` of ${formatCount(c.total)}` : ''}
                {c.status === 'running' ? ' (running)' : ''}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <details className="rounded-2xl border border-rule bg-surface">
        <summary className="tap min-h-11 cursor-pointer px-4 py-3 text-sm font-medium text-muted">
          Try the phone assistant (optional)
        </summary>
        <div className="border-t border-rule px-2 pb-2">
          <GrokTestCall eventId={eventId} eventCode={eventCode} configured={grokConfigured} />
        </div>
      </details>
    </div>
  )
}

export default CampaignBoard
