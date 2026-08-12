import type { Metadata } from 'next'
import type { SupabaseClient } from '@supabase/supabase-js'
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

/**
 * A row of `v_review_queue`.
 *
 * Declared by hand because `database.types.ts` is generated from the LINKED
 * project (`npm run types:gen`) and the view ships in migration
 * 20260810130000, which is not applied yet. Once it is pushed and the types
 * are regenerated, this shape is redundant and the cast below can go — but it
 * must stay until then, or the page will not compile.
 */
type ReviewQueueRow = {
  kind: 'extraction' | 'manual'
  item_id: string
  group_id: string | null
  waiting_since: string
  recording_id: string | null
  failure_reason: string | null
  duration_sec: number | null
}

export function generateStaticParams(): Array<Record<string, string>> {
  return [{}]
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

  // Two reads, because the queue has two shapes.
  //
  // `v_review_queue` is the authority on WHAT needs a human — pending
  // extractions plus calls whose transcription failed or never ran. The
  // extraction details (confidence, parsed draft) still come from
  // rsvp_extractions, because the view deliberately carries only the columns
  // both kinds share.
  //
  // A failed transcription has no extraction row at all. Reading
  // rsvp_extractions alone — which is what this page used to do — made those
  // calls structurally invisible: the caller had the conversation and the
  // outcome silently vanished. See the migration header.
  // The generated client does not know `v_review_queue` yet (see
  // ReviewQueueRow). Cast only for this one query rather than loosening the
  // typed client everywhere else on the page.
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

  // See ReviewQueueRow above: the generated types do not carry this view yet.
  const queueRows = (queueRowsRaw ?? []) as unknown as ReviewQueueRow[]

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
  const byId = new Map(rows.map((ex) => [ex.id, ex]))

  const manualRows = (queueRows ?? []).filter((r) => r.kind === 'manual')

  // The view carries group_id but not the family's name — resolve it so a
  // manual item reads like every other review item rather than a bare uuid.
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

  // Manual items sort ABOVE everything. They are the ones with no draft and
  // no safety net — a caller who never gets to them loses the call outcome
  // entirely, whereas a missed extraction still has its AI draft waiting.
  const orderedQueue = [
    ...manualRows,
    ...(queueRows ?? []).filter((r) => r.kind === 'extraction' && byId.has(r.item_id)),
  ]

  const manualCount = manualRows.length
  const totalCount = orderedQueue.length

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
          {totalCount === 0
            ? 'Nothing waiting right now.'
            : `${formatCount(totalCount)} waiting. Nothing writes to guest data until you accept.`}
        </p>
        {manualCount > 0 ? (
          <p className="mt-1 text-sm font-medium text-warning">
            {formatCount(manualCount)} need{manualCount === 1 ? 's' : ''} manual entry — the
            recording is there, the transcription is not.
          </p>
        ) : null}
      </div>

      {totalCount === 0 ? (
        <EmptyState
          icon={<ClipboardCheckIcon className="h-7 w-7" />}
          title="Nothing waiting for review"
          description="RSVP call extractions land here once the AI has produced a draft. Nothing writes to guest data until a person reviews it and accepts."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {orderedQueue.map((item) => {
            // ---- Manual entry: a real call with no usable draft. -------------
            // Routed at the EXISTING manual RSVP path, not a parallel copy of
            // it, so "the manual path works exactly as it does today" stays
            // true by construction. ?recording= surfaces the audio there.
            if (item.kind === 'manual') {
              const g = item.group_id ? groupById.get(item.group_id) : null
              const href = item.group_id
                ? `/${event.code}/rsvp/${item.group_id}?recording=${item.recording_id}&from=review`
                : null

              const card = (
                <Card className="border-warning/50 bg-tint-warning transition-colors hover:bg-surface-2 active:bg-surface-2">
                  <CardBody className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-fg">
                        {g?.head_name ?? 'Call with no family linked'}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1 text-sm text-muted">
                        <ClockIcon className="h-4 w-4 shrink-0" />
                        {formatDateTime(item.waiting_since)}
                        {typeof item.duration_sec === 'number'
                          ? ` · ${item.duration_sec}s`
                          : ''}
                      </p>
                      <p className="mt-1 text-sm font-medium text-warning">
                        Transcription failed — enter manually
                      </p>
                      <p className="mt-0.5 text-xs text-subtle">
                        {item.failure_reason === 'too_short'
                          ? 'Recording too short to transcribe. Listen and type the outcome.'
                          : item.failure_reason === 'no_transcript'
                            ? 'Transcription never ran. Listen and type the outcome.'
                            : 'Listen to the recording and type the outcome.'}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge tone="warning">Manual</Badge>
                    </div>
                  </CardBody>
                </Card>
              )

              return (
                <li key={`manual-${item.item_id}`}>
                  {href ? (
                    <Link href={href} className="block">
                      {card}
                    </Link>
                  ) : (
                    // No group means no RSVP form to send her to. Still shown —
                    // a call must never vanish — but it needs an admin to link
                    // the recording to a family first.
                    card
                  )}
                </li>
              )
            }

            // ---- Normal path: an AI draft awaiting review. -------------------
            const ex = byId.get(item.item_id)
            if (!ex) return null

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
