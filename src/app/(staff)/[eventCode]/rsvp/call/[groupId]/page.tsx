import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { getSessionClaims } from '@/lib/auth/server'
import { requireStaff, resolveEventByCode } from '@/lib/supabase/queries'
import { CallScreen } from './CallScreen'

type PageProps = {
  params: Promise<{ eventCode: string; groupId: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { groupId } = await params
  return { title: `Call — ${groupId.slice(0, 8)}` }
}

export function generateStaticParams(): Array<Record<string, string>> {
  return []
}

export default async function CallGroupPage({ params }: PageProps) {
  const { eventCode, groupId } = await params

  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  await requireStaff(event.id, event.code)

  const supabase = await createClient()
  const claims = await getSessionClaims()
  const callerId = claims?.staffMemberId ?? null

  // Pre-condition: the group must exist and be visible to this caller.
  const { data: group, error: groupError } = await supabase
    .from('guest_groups')
    .select('*')
    .eq('id', groupId)
    .eq('event_id', event.id)
    .maybeSingle()

  if (groupError || !group) notFound()

  // Fire-and-forget presence: stamp who opened this and when. Never awaited,
  // never surfaced as an error — this is a best-effort signal, not a lock.
  if (callerId) {
    supabase
      .from('guest_groups')
      .update({ last_opened_by_staff: callerId } as Record<string, unknown> as never)
      .eq('id', groupId)
      .eq('event_id', event.id)
      .then(({ error }) => {
        if (error) {
          console.error('[presence] last_opened_by_staff update failed:', { groupId, eventId: event.id, code: (error as any)?.code, message: error.message })
        }
      })
  }

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
