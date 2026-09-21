'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'

import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { SectionHead } from '@/components/ui/SectionHead'
import {
  type CampaignRow,
  setCampaignStatus,
  startCampaign,
} from '@/lib/actions/campaigns'
import { dialNextCampaignJob } from '@/lib/actions/outbound'
import { formatCount } from '@/lib/utils'
import { GrokTestCall } from '@/components/rsvp/GrokTestCall'

const ROUND_NAMES: Record<string, string> = {
  wave_1: 'Round 1 — about one month before',
  wave_2: 'Round 2 — about ten days before',
  wave_3: 'Round 3 — about two days before',
}

function roundLabel(c: CampaignRow): string {
  return ROUND_NAMES[c.wave] ?? c.label
}

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
  const activeRound = campaigns.find((c) => c.status === 'running')
    ?? campaigns.find((c) => c.status === 'draft' || c.status === 'paused')

  function run(
    fn: () => Promise<{ ok: boolean; error?: string; message?: string }>,
  ) {
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
      <div className="flex flex-col gap-4">
        <SectionHead eyebrow="RSVP calls" title="Call families and note who is coming" />
        <Card>
          <CardBody className="flex flex-col gap-3 py-6 text-center">
            <p className="text-base text-ink">No families on the list yet.</p>
            <p className="text-sm text-muted">
              Import the guest list first. Then you can start calling.
            </p>
            <Link
              href={`/${eventCode}/guests/import`}
              className="tap flex min-h-12 items-center justify-center rounded-xl bg-brand text-base font-semibold text-white"
            >
              Import guest list
            </Link>
          </CardBody>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <SectionHead
        eyebrow="RSVP calls"
        title="Call families and note who is coming"
        right={totalFamilies > 0 ? `${formatCount(confirmed)} confirmed` : undefined}
      />

      <Card className="border-brand/25 bg-[linear-gradient(158deg,var(--ef-brand-tint),transparent_62%)]">
        <CardBody className="flex flex-col gap-3">
          <p className="text-3xl font-medium tabular-nums text-ink">
            {formatCount(totalFamilies)}
            <span className="ml-2 text-base font-normal text-muted">families to call</span>
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link
              href={`/${eventCode}/rsvp/queue`}
              className="tap flex min-h-12 flex-1 items-center justify-center rounded-xl border border-rule bg-surface text-base font-semibold text-ink"
            >
              Call by hand
            </Link>
            <Link
              href={`/${eventCode}/rsvp/review`}
              className="tap flex min-h-12 flex-1 items-center justify-center rounded-xl border border-rule bg-surface text-base font-semibold text-ink"
            >
              Check call notes
            </Link>
          </div>
        </CardBody>
      </Card>

      {staffCount === 0 ? (
        <p className="rounded-xl border border-rule bg-tint-warning px-4 py-3 text-sm text-warning">
          Add staff names in admin so each caller can tap their name at login.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-xl border border-ledger-red bg-red-tint px-4 py-3 text-sm text-ledger-red">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-xl border border-rule bg-surface px-4 py-3 text-sm text-ink">{notice}</p>
      ) : null}

      {activeRound ? (
        <Card edge={activeRound.status === 'running' ? 'active' : 'neutral'}>
          <CardBody className="flex flex-col gap-3">
            <div>
              <h2 className="text-lg font-semibold text-ink">{roundLabel(activeRound)}</h2>
              <p className="text-sm text-muted">
                {activeRound.total > 0
                  ? `${formatCount(activeRound.completed)} of ${formatCount(activeRound.total)} families called in this round`
                  : 'Not started yet — tap the button below to build the call list.'}
              </p>
            </div>

            {activeRound.status === 'draft' || activeRound.status === 'paused' ? (
              <Button
                size="lg"
                fullWidth
                loading={pending}
                onClick={() => run(() => startCampaign(activeRound.id, eventId, eventCode))}
              >
                {activeRound.status === 'paused' ? 'Resume auto-calling' : 'Start auto-calling this round'}
              </Button>
            ) : null}

            {activeRound.status === 'running' ? (
              <>
                <Button
                  size="lg"
                  fullWidth
                  loading={pending}
                  onClick={() => run(() => dialNextCampaignJob(activeRound.id, eventId, eventCode))}
                >
                  Call the next family
                </Button>
                <Button
                  size="lg"
                  variant="secondary"
                  fullWidth
                  loading={pending}
                  onClick={() => run(() => setCampaignStatus(activeRound.id, eventId, eventCode, 'paused'))}
                >
                  Pause auto-calling
                </Button>
              </>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {campaigns.length > 1 ? (
        <details className="rounded-xl border border-rule bg-surface px-4 py-2">
          <summary className="tap min-h-11 cursor-pointer text-sm font-medium text-ink">
            All calling rounds ({campaigns.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-2 pb-2">
            {campaigns.map((c) => (
              <li key={c.id} className="text-sm text-muted">
                <span className="font-medium text-ink">{roundLabel(c)}</span>
                {' — '}
                {formatCount(c.completed)} done
                {c.total > 0 ? ` of ${formatCount(c.total)}` : ''}
                {c.status === 'running' ? ' (running now)' : ''}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <details className="rounded-xl border border-rule bg-surface">
        <summary className="tap min-h-12 cursor-pointer px-4 py-3 text-sm font-medium text-muted">
          Try the phone assistant in your browser (optional)
        </summary>
        <div className="border-t border-rule px-2 pb-2">
          <GrokTestCall eventId={eventId} eventCode={eventCode} configured={grokConfigured} />
        </div>
      </details>
    </div>
  )
}
