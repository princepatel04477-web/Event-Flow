import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { EmptyState } from '@/components/ui/EmptyState'
import { Progress } from '@/components/ui/Progress'
import { ReadFailure } from '@/components/ui/ReadFailure'
import { Row } from '@/components/ui/Row'
import { InboxIcon } from '@/components/icons'
import { createClient } from '@/lib/supabase/server'
import { requireStaff, resolveEventByCode } from '@/lib/supabase/queries'
import { traceFetch } from '@/lib/perf'
import { rsvpStatusLabel } from '@/lib/rsvp'
import { statusTone } from '@/lib/status'
import { initials } from '@/lib/ui/metrics'

export const metadata: Metadata = {
  title: 'RSVP',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
}

function rowTone(status: string): 'neutral' | 'done' | 'waiting' | 'problem' {
  const t = statusTone(status)
  if (t === 'done') return 'done'
  if (t === 'attention') return 'problem'
  if (t === 'active') return 'waiting'
  return 'neutral'
}

export default async function RsvpIndexPage({ params }: PageProps) {
  const { eventCode } = await params

  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  await requireStaff(event.id, event.code)

  const supabase = await createClient()

  const [{ data: queue, error: queueError }, { data: groups, error: groupsError }] =
    await traceFetch('rsvp :: index', () =>
      Promise.all([
        supabase
          .from('v_rsvp_queue')
          .select('*')
          .eq('event_id', event.id)
          .order('attempt_count', { ascending: true })
          .order('last_attempt_at', { ascending: true })
          .order('head_name', { ascending: true }),
        supabase.from('guest_groups').select('id, head_name, rsvp_status').eq('event_id', event.id),
      ]),
    )

  // THE ERROR IS CHECKED NOW (M11). Both reads used to discard it, so a failed
  // request produced `[]` and the empty state below rendered "Nothing waiting to
  // call — Every family has been called, or the list is empty." Either failing
  // read makes BOTH the list and the progress bar untrustworthy, so both are
  // checked: a run of 238 families must never be declared finished because a
  // handset lost its link for one second.
  if (queueError || groupsError) {
    return <ReadFailure what="the calling list" />
  }

  const total = groups?.length ?? 0
  const contacted = (groups ?? []).filter(
    (g) => g.rsvp_status !== 'not_started' && g.rsvp_status !== 'attempted',
  ).length
  const rows = queue ?? []

  return (
    <div className="flex flex-col gap-4 pb-nav">
      {total > 0 ? (
        <Progress
          label="Families contacted"
          done={contacted}
          total={total}
          tone="green"
        />
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon={<InboxIcon className="h-7 w-7" />}
          title="Nothing waiting to call"
          description="Every family has been called, or the list is empty."
        />
      ) : (
        <ul
          className="flex flex-col overflow-hidden rounded-2xl border border-rule bg-surface"
          role="list"
        >
          {rows.map((row) => {
            const name = row.head_name?.trim() || 'Family'
            const status = row.rsvp_status ?? 'not_started'
            const attempts = row.attempt_count ?? 0
            return (
              <li key={row.group_id}>
                <Link href={`/${event.code}/rsvp/status/${row.group_id}`} className="block">
                  <Row
                    heading={name}
                    meta={
                      attempts > 0
                        ? `${attempts} ${attempts === 1 ? 'call' : 'calls'}`
                        : undefined
                    }
                    initials={initials(name)}
                    // The canonical vocabulary, whole. `statusLabel` never
                    // shortens; an earlier cut took the first word of the label,
                    // so "Not started" rendered as "Not" — a word that reads as
                    // the start of "Not coming".
                    status={rsvpStatusLabel(status)}
                    tone={rowTone(status)}
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
