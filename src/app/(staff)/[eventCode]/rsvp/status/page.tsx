import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Badge } from '@/components/ui/Badge'
import { Card, CardBody } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { SectionHead } from '@/components/ui/SectionHead'
import { InboxIcon } from '@/components/icons'
import { createClient } from '@/lib/supabase/server'
import { requireStaff, resolveEventByCode } from '@/lib/supabase/queries'
import { traceFetch } from '@/lib/perf'
import { rsvpStatusLabel, rsvpStatusTone } from '@/lib/rsvp'
import { formatCount } from '@/lib/utils'

export const metadata: Metadata = {
  title: 'RSVP Logging',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
}

export function generateStaticParams(): Array<Record<string, string>> {
  return [{}]
}

export default async function RsvpIndexPage({ params }: PageProps) {
  const { eventCode } = await params

  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  await requireStaff(event.id, event.code)

  const supabase = await createClient()

  // The queue view is the source of truth for "still to call". Progress is
  // "families no longer waiting" (i.e. the rest of the list) out of total.
  const [{ data: queue }, { data: groups }] = await traceFetch('rsvp :: index', () =>
    Promise.all([
      supabase.from('v_rsvp_queue').select('*').eq('event_id', event.id).order('attempt_count', { ascending: true }).order('last_attempt_at', { ascending: true }).order('head_name', { ascending: true }),
      supabase.from('guest_groups').select('id, head_name, rsvp_status').eq('event_id', event.id),
    ]),
  )

  const total = groups?.length ?? 0
  const contacted = (groups ?? []).filter((g) => g.rsvp_status !== 'not_started' && g.rsvp_status !== 'attempted').length
  const rows = queue ?? []

  return (
    <div className="flex flex-col gap-4">
      <SectionHead eyebrow="RSVP calls" title="Log an RSVP" />

      <Card className="border-border-strong bg-surface-2">
        <CardBody className="py-3 text-sm text-fg">
          <p className="font-semibold">
            {formatCount(contacted)} of {formatCount(total)} families contacted
          </p>
          <p className="mt-0.5 text-muted">
            {formatCount(rows.length)} families still need a call.
          </p>
        </CardBody>
      </Card>

      {rows.length === 0 ? (
        <EmptyState
          icon={<InboxIcon className="h-7 w-7" />}
          title="Nothing waiting to call"
          description="Every family on the list has been called, or the list is empty. Import the guest list to begin."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.group_id}>
              <Link href={`/${event.code}/rsvp/${row.group_id}`} className="block">
                <Card className="transition-colors hover:bg-surface-2 active:bg-surface-2">
                  <CardBody className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-fg">{row.head_name}</p>
                      <p className="mt-0.5 text-sm text-muted">
                        {(row.attempt_count ?? 0)} call{(row.attempt_count ?? 0) === 1 ? '' : 's'} so far
                      </p>
                    </div>
                    <Badge tone={rsvpStatusTone(row.rsvp_status ?? 'not_started')}>
                      {rsvpStatusLabel(row.rsvp_status ?? 'not_started')}
                    </Badge>
                  </CardBody>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
