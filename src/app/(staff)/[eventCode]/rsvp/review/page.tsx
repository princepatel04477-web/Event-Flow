import type { Metadata } from 'next'
import type { SupabaseClient } from '@supabase/supabase-js'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { ClipboardCheckIcon, ShieldAlertIcon } from '@/components/icons'
import { EmptyState } from '@/components/ui/EmptyState'
import { Row } from '@/components/ui/Row'
import { createClient } from '@/lib/supabase/server'
import { requireStaff, resolveEventByCode } from '@/lib/supabase/queries'
import { traceFetch } from '@/lib/perf'
import { RSVP_STATUS_LABELS, parseExtractionPayload } from '@/lib/review/payload'
import { summarizeConfidence } from '@/lib/review/confidence'
import { initials } from '@/lib/ui/metrics'
import { formatCount, formatDateTime } from '@/lib/utils'

export const metadata: Metadata = {
  title: 'Review',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
  searchParams: Promise<{ done?: string }>
}

type ReviewQueueRow = {
  kind: 'extraction' | 'manual'
  item_id: string
  group_id: string | null
  waiting_since: string
  recording_id: string | null
  failure_reason: string | null
  duration_sec: number | null
}

export default async function ReviewListPage({ params, searchParams }: PageProps) {
  const { eventCode } = await params
  const { done } = await searchParams

  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  await requireStaff(event.id, event.code)

  const supabase = await createClient()
  const untypedDb = supabase as unknown as SupabaseClient

  const [queueRes, extractionRes] = await Promise.all([
    traceFetch('review :: v_review_queue', () =>
      untypedDb
        .from('v_review_queue')
        .select('kind, item_id, group_id, waiting_since, recording_id, failure_reason, duration_sec')
        .eq('event_id', event.id)
        .order('waiting_since', { ascending: false }),
    ),
    traceFetch('review :: rsvp_extractions', () =>
      supabase
        .from('rsvp_extractions')
        .select('id, created_at, confidence, parsed, group_id, guest_groups(head_name, primary_mobile)')
        .eq('event_id', event.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false }),
    ),
  ])

  const { data: queueRowsRaw, error: queueError } = queueRes
  const { data: extractions, error: extractionError } = extractionRes
  const error = queueError ?? extractionError

  const queueRows = (queueRowsRaw ?? []) as unknown as ReviewQueueRow[]

  if (error) {
    return (
      <EmptyState
        icon={<ShieldAlertIcon className="h-7 w-7" />}
        title="Could not load the review queue"
        description="Reload the page. If it keeps failing, tell your admin."
      />
    )
  }

  const rows = extractions ?? []
  const byId = new Map(rows.map((ex) => [ex.id, ex]))

  const manualRows = (queueRows ?? []).filter((r) => r.kind === 'manual')

  const manualGroupIds = [
    ...new Set(manualRows.map((r) => r.group_id).filter((id): id is string => Boolean(id))),
  ]
  const { data: manualGroups } = manualGroupIds.length
    ? await traceFetch('review :: manual groups', () =>
        supabase
          .from('guest_groups')
          .select('id, head_name, primary_mobile')
          .eq('event_id', event.id)
          .in('id', manualGroupIds),
      )
    : { data: [] as { id: string; head_name: string; primary_mobile: string | null }[] }

  const groupById = new Map((manualGroups ?? []).map((g) => [g.id, g]))

  const orderedQueue = [
    ...manualRows,
    ...(queueRows ?? []).filter((r) => r.kind === 'extraction' && byId.has(r.item_id)),
  ]

  const manualCount = manualRows.length
  const totalCount = orderedQueue.length

  return (
    <div className="flex flex-col gap-4 pb-nav">
      {done === 'accepted' ? (
        <p className="rounded-xl border border-ledger-green/30 bg-green-tint px-3.5 py-3 text-sm font-medium text-ledger-green">
          Applied. Guest data updated.
        </p>
      ) : null}
      {done === 'rejected' ? (
        <p className="rounded-xl border border-rule bg-surface-2 px-3.5 py-3 text-sm font-medium text-ink">
          Rejected. Nothing was written to guest data.
        </p>
      ) : null}

      <p className="text-sm text-muted">
        {totalCount === 0
          ? 'Nothing waiting.'
          : `${formatCount(totalCount)} waiting — accept to write guest data.`}
        {manualCount > 0
          ? ` ${formatCount(manualCount)} need manual entry.`
          : ''}
      </p>

      {totalCount === 0 ? (
        <EmptyState
          icon={<ClipboardCheckIcon className="h-7 w-7" />}
          title="Nothing to review"
          description="AI drafts from calls appear here. Nothing writes until you accept."
        />
      ) : (
        <ul
          className="flex flex-col overflow-hidden rounded-2xl border border-rule bg-surface"
          role="list"
        >
          {orderedQueue.map((item) => {
            if (item.kind === 'manual') {
              const g = item.group_id ? groupById.get(item.group_id) : null
              const name = g?.head_name ?? 'Call with no family'
              const href = item.group_id
                ? `/${event.code}/rsvp/status/${item.group_id}?recording=${item.recording_id}&from=review`
                : null
              const meta = `${formatDateTime(item.waiting_since)} · Manual`

              const row = (
                <Row
                  heading={name}
                  meta={meta}
                  initials={initials(name)}
                  status="Manual"
                  tone="waiting"
                />
              )

              return (
                <li key={`manual-${item.item_id}`}>
                  {href ? (
                    <Link href={href} className="block">
                      {row}
                    </Link>
                  ) : (
                    row
                  )}
                </li>
              )
            }

            const ex = byId.get(item.item_id)
            if (!ex) return null

            const group = (ex.guest_groups ?? null) as {
              head_name: string
              primary_mobile: string | null
            } | null
            const parsed = parseExtractionPayload(ex.parsed)
            const { lowCount } = summarizeConfidence(ex.confidence)
            const name = group?.head_name ?? 'Unknown group'
            const guess = parsed.rsvp_status
              ? RSVP_STATUS_LABELS[parsed.rsvp_status as keyof typeof RSVP_STATUS_LABELS] ??
                parsed.rsvp_status
              : null
            const meta = [
              formatDateTime(ex.created_at),
              guess,
              typeof parsed.confirmed_pax === 'number' ? `${parsed.confirmed_pax} pax` : null,
            ]
              .filter(Boolean)
              .join(' · ')

            return (
              <li key={ex.id}>
                <Link href={`/${event.code}/rsvp/review/${ex.id}`} className="block">
                  <Row
                    heading={name}
                    meta={meta}
                    initials={initials(name)}
                    status={lowCount > 0 ? 'Check' : 'Draft'}
                    tone={lowCount > 0 ? 'waiting' : 'done'}
                  />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
