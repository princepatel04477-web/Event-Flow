'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'

import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import {
  type CampaignRow,
  setCampaignStatus,
  startCampaign,
} from '@/lib/actions/campaigns'
import { dialNextCampaignJob } from '@/lib/actions/outbound'
import { formatCount } from '@/lib/utils'
import { GrokTestCall } from '@/components/rsvp/GrokTestCall'

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

  function run(
    fn: () => Promise<{ ok: boolean; error?: string; message?: string }>,
  ) {
    if (pending) return
    setError(null)
    setNotice(null)
    startTransition(async () => {
      const res = await fn()
      if (!res.ok) setError(res.error ?? 'Something went wrong.')
      else if (res.message) setNotice(res.message)
    })
  }

  const checklist = [
    { done: guestCount > 0, label: 'Guest list imported', href: `/${eventCode}/guests/import` },
    { done: staffCount > 0, label: 'Staff names and departments added', href: `/admin/events/${eventCode}/staff` },
    { done: grokConfigured, label: 'Grok voice API key configured', href: undefined },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-ink">RSVP calling</h1>
        <p className="mt-1 text-sm text-muted">
          Three waves before the wedding. The AI agent calls each family, records arrival
          details, and sends them to call notes for you to confirm.
        </p>
      </div>

      <Card>
        <CardBody className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-ink">Before you start</h2>
          <ul className="flex flex-col gap-2">
            {checklist.map((item) => (
              <li key={item.label} className="flex items-center gap-2 text-sm">
                <span
                  aria-hidden
                  className={`h-2 w-2 rounded-full ${item.done ? 'bg-ledger-green' : 'bg-muted'}`}
                />
                {item.href && !item.done ? (
                  <Link href={item.href} className="text-brand underline">{item.label}</Link>
                ) : (
                  <span className={item.done ? 'text-ink' : 'text-muted'}>{item.label}</span>
                )}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      {error ? (
        <p role="alert" className="rounded-xl border border-ledger-red bg-red-tint px-4 py-3 text-sm text-ledger-red">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-xl border border-rule bg-surface px-4 py-3 text-sm text-ink">{notice}</p>
      ) : null}

      <GrokTestCall eventId={eventId} eventCode={eventCode} configured={grokConfigured} />

      <div className="flex flex-col gap-3">
        {campaigns.map((c) => (
          <Card key={c.id} edge={c.status === 'running' ? 'active' : 'neutral'}>
            <CardBody className="flex flex-col gap-3">
              <div>
                <h3 className="font-semibold text-ink">{c.label}</h3>
                <p className="text-xs text-muted">
                  {c.scheduledFor ? `Scheduled ${c.scheduledFor}` : `${c.daysBefore} days before wedding`}
                  {' · '}
                  {formatCount(c.completed)} done
                  {c.total > 0 ? ` of ${formatCount(c.total)}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {c.status === 'draft' || c.status === 'paused' ? (
                  <Button
                    size="md"
                    loading={pending}
                    onClick={() => run(() => startCampaign(c.id, eventId, eventCode))}
                  >
                    {c.status === 'paused' ? 'Resume' : 'Start wave'}
                  </Button>
                ) : null}
                {c.status === 'running' ? (
                  <>
                    <Button
                      size="md"
                      loading={pending}
                      onClick={() => run(() => dialNextCampaignJob(c.id, eventId, eventCode))}
                    >
                      Dial next
                    </Button>
                    <Button
                      size="md"
                      variant="secondary"
                      loading={pending}
                      onClick={() => run(() => setCampaignStatus(c.id, eventId, eventCode, 'paused'))}
                    >
                      Pause
                    </Button>
                  </>
                ) : null}
                <Link
                  href={`/${eventCode}/rsvp/queue`}
                  className="tap inline-flex min-h-10 items-center rounded-lg border border-rule px-3 text-sm font-medium text-ink"
                >
                  Manual calls
                </Link>
                <Link
                  href={`/${eventCode}/rsvp/review`}
                  className="tap inline-flex min-h-10 items-center rounded-lg border border-rule px-3 text-sm font-medium text-ink"
                >
                  Call notes
                </Link>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  )
}
