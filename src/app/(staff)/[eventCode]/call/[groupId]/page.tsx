import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { BackRow } from './BackRow'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { ShieldAlertIcon, ClockIcon } from '@/components/icons'
import { createClient } from '@/lib/supabase/server'
import { getSessionClaims } from '@/lib/auth/server'
import { requireStaff, resolveEventByCode } from '@/lib/supabase/queries'
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

  // No getViewer() pre-check: it only understands GoTrue (admin) sessions and
  // returns null for a code-auth team session, which would bounce staff to
  // /login. requireStaff() below resolves both session types via the claims.

  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  // Staff only, and BEFORE the claim below — claim_group() takes a
  // 15-minute lock, so a non-staff visitor must be turned away before any
  // side effect fires, not after it.
  await requireStaff(event.id, event.code)

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

  // The caller's identity: code sessions use the selected staff member
  // (locked_by_staff / caller_id_staff); admins use their auth uid
  // (locked_by / caller_id). The attribution split keeps exactly one of
  // each pair — resolve whichever is present.
  const claims = await getSessionClaims()
  const callerId = claims?.staffMemberId ?? group.locked_by ?? group.locked_by_staff ?? null

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

  // An in-flight attempt is one this caller left open. The caller id may be
  // in caller_id (admin) or caller_id_staff (team) — match either.
  const inFlightAttempt =
    (attempts ?? []).find(
      (a) =>
        a.outcome === null &&
        (a.caller_id === callerId || a.caller_id_staff === callerId),
    ) ?? null

  return (
    <CallScreen
      eventId={event.id}
      eventCode={event.code}
      viewerId={callerId ?? ''}
      group={group}
      attempts={attempts ?? []}
      travelLegs={travelLegs ?? []}
      inFlightAttempt={inFlightAttempt}
    />
  )
}
