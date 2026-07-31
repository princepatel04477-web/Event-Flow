import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import { BackRow } from './BackRow'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { ShieldAlertIcon, ClockIcon } from '@/components/icons'
import { createClient } from '@/lib/supabase/server'
import { getEventByCode, getViewer } from '@/lib/supabase/queries'
import { claimGroupForCall } from '@/lib/actions/call'
import { formatMobile } from '@/lib/phone'
import { formatDateTime } from '@/lib/utils'
import { CallScreen } from './CallScreen'

type PageProps = {
  // Next 15+ hands params over as a Promise.
  params: Promise<{ eventCode: string; groupId: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { groupId } = await params
  return { title: `Call — ${groupId.slice(0, 8)}` }
}

export default async function CallGroupPage({ params }: PageProps) {
  const { eventCode, groupId } = await params

  const viewer = await getViewer()
  if (!viewer) {
    redirect(`/login?next=${encodeURIComponent(`/${eventCode}/call/${groupId}`)}`)
  }

  const event =
    (await getEventByCode(eventCode)) ?? (await getEventByCode(eventCode.toUpperCase()))
  if (!event) notFound()

  // Opening this screen IS "claiming" the group for calling — claim_group()
  // is re-entrant for the same caller, so a refresh just re-confirms the
  // lock rather than fighting it.
  const claim = await claimGroupForCall(event.id, groupId)

  if (claim.ok === false && claim.reason === 'not_found') {
    notFound()
  }

  if (claim.ok === false && claim.reason === 'error') {
    return (
      <div className="flex flex-col gap-4">
        <BackRow href={`/${event.code}/queue`} title="Could not open" />
        <EmptyState
          icon={<ShieldAlertIcon className="h-7 w-7" />}
          title="Could not open this family"
          description={claim.message}
        />
      </div>
    )
  }

  if (claim.ok === false && claim.reason === 'locked') {
    const group = claim.group
    const untilLabel = group?.locked_until
      ? formatDateTime(group.locked_until, { hour: '2-digit', minute: '2-digit', hour12: false })
      : null

    return (
      <div className="flex flex-col gap-4">
        <BackRow
          href={`/${event.code}/queue`}
          title={group?.head_name ?? 'Locked'}
          subtitle={group ? formatMobile(group.primary_mobile) : undefined}
        />
        <EmptyState
          icon={<ClockIcon className="h-7 w-7" />}
          title="Someone else is already calling this family"
          description={
            untilLabel
              ? `The lock releases automatically by ${untilLabel} if they don't finish first. Try another family from the queue in the meantime.`
              : "The lock releases automatically. Try another family from the queue in the meantime."
          }
          action={
            <Badge tone="warning" size="md">
              Locked
            </Badge>
          }
        />
      </div>
    )
  }

  const group = claim.group

  const supabase = await createClient()
  const [{ data: attempts }, { data: travelLegs }] = await Promise.all([
    supabase
      .from('call_attempts')
      .select('*')
      .eq('group_id', groupId)
      .eq('event_id', event.id)
      .order('started_at', { ascending: false }),
    supabase
      .from('travel_legs')
      .select('*')
      .eq('group_id', groupId)
      .eq('event_id', event.id)
      .order('travel_date', { ascending: true, nullsFirst: false }),
  ])

  const inFlightAttempt =
    (attempts ?? []).find((a) => a.outcome === null && a.caller_id === viewer.userId) ?? null

  return (
    <CallScreen
      eventId={event.id}
      eventCode={event.code}
      viewerId={viewer.userId}
      group={group}
      attempts={attempts ?? []}
      travelLegs={travelLegs ?? []}
      inFlightAttempt={inFlightAttempt}
    />
  )
}
