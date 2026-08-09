import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Badge } from '@/components/ui/Badge'
import { Card, CardBody } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  CheckCircleIcon,
  ClipboardCheckIcon,
  ClockIcon,
  ShieldAlertIcon,
} from '@/components/icons'
import { createClient } from '@/lib/supabase/server'
import { requireStaff, resolveEventByCode } from '@/lib/supabase/queries'
import { traceFetch } from '@/lib/perf'
import { RSVP_STATUS_LABELS, parseExtractionPayload } from '@/lib/review/payload'
import { summarizeConfidence } from '@/lib/review/confidence'
import { formatCount, formatDateTime } from '@/lib/utils'

export const metadata: Metadata = {
  title: 'Review',
}

type PageProps = {
  // Next 15+ hands params and searchParams over as Promises.
  params: Promise<{ eventCode: string }>
  searchParams: Promise<{ done?: string }>
}

export default async function ReviewListPage({ params, searchParams }: PageProps) {
  const { eventCode } = await params
  const { done } = await searchParams

  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  // Staff only. `rsvp_extractions` is fenced by `app.is_staff(event_id)`, so
  // a client's read is zero rows with no error — which this page would print
  // as "Nothing waiting for review" while ten extractions sat pending.
  await requireStaff(event.id, event.code)

  const supabase = await createClient()

  const { data: extractions, error } = await traceFetch('review :: rsvp_extractions', () =>
    supabase
      .from('rsvp_extractions')
      .select('id, created_at, confidence, parsed, group_id, guest_groups(head_name, primary_mobile)')
      .eq('event_id', event.id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
  )

  // `extractions ?? []` alone collapses a failed read and an empty queue into
  // one screen. Say which happened — "nothing to review" is a claim about the
  // event, and we only earn it when the query actually came back.
  if (error) {
    return (
      <EmptyState
        icon={<ShieldAlertIcon className="h-7 w-7" />}
        title="Could not load the review queue"
        description="The pending extractions did not come back from the database this time. This is a load failure, not an empty queue — reload the page, and tell your admin if it keeps happening."
      />
    )
  }

  const rows = extractions ?? []

  return (
    <div className="flex flex-col gap-4">
      {done === 'accepted' ? (
        <Card className="border-success/40 bg-tint-success">
          <CardBody className="flex items-center gap-2 py-3">
            <CheckCircleIcon className="h-5 w-5 shrink-0 text-success" />
            <p className="text-sm font-medium text-success">
              Applied. Guest data updated and the caller lock was released.
            </p>
          </CardBody>
        </Card>
      ) : null}
      {done === 'rejected' ? (
        <Card className="border-border-strong bg-surface-2">
          <CardBody className="py-3">
            <p className="text-sm font-medium text-fg">
              Rejected. Nothing was written to guest data.
            </p>
          </CardBody>
        </Card>
      ) : null}

      <div>
        <h2 className="text-xl font-semibold text-fg">Review queue</h2>
        <p className="mt-0.5 text-sm text-muted">
          {rows.length === 0
            ? 'Nothing waiting right now.'
            : `${formatCount(rows.length)} extraction${rows.length === 1 ? '' : 's'} waiting. Nothing writes to guest data until you accept.`}
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheckIcon className="h-7 w-7" />}
          title="Nothing waiting for review"
          description="RSVP call extractions land here once the AI has produced a draft. Nothing writes to guest data until a person reviews it and accepts."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((ex) => {
            const group = (ex.guest_groups ?? null) as {
              head_name: string
              primary_mobile: string | null
            } | null
            const parsed = parseExtractionPayload(ex.parsed)
            const { lowest, lowCount } = summarizeConfidence(ex.confidence)

            return (
              <li key={ex.id}>
                <Link href={`/${event.code}/review/${ex.id}`} className="block">
                  <Card className="transition-colors hover:bg-surface-2 active:bg-surface-2">
                    <CardBody className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-fg">
                          {group?.head_name ?? 'Unknown group'}
                        </p>
                        <p className="mt-0.5 flex items-center gap-1 text-sm text-muted">
                          <ClockIcon className="h-4 w-4 shrink-0" />
                          {formatDateTime(ex.created_at)}
                        </p>
                        {parsed.rsvp_status ? (
                          <p className="mt-1 text-sm text-subtle">
                            AI guess:{' '}
                            {RSVP_STATUS_LABELS[
                              parsed.rsvp_status as keyof typeof RSVP_STATUS_LABELS
                            ] ?? parsed.rsvp_status}
                            {typeof parsed.confirmed_pax === 'number'
                              ? ` · ${parsed.confirmed_pax} pax`
                              : ''}
                          </p>
                        ) : null}
                      </div>

                      <div className="flex shrink-0 flex-col items-end gap-1">
                        {lowCount > 0 ? (
                          <Badge tone="warning">
                            {lowCount} low-confidence
                          </Badge>
                        ) : (
                          <Badge tone="success">Looks solid</Badge>
                        )}
                        {lowest !== null ? (
                          <span className="text-xs text-subtle">
                            min {(lowest * 100).toFixed(0)}%
                          </span>
                        ) : null}
                      </div>
                    </CardBody>
                  </Card>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
