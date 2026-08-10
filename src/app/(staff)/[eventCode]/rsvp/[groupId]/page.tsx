import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { BackRow } from './BackRow'
import { Card, CardBody } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { ShieldAlertIcon, ClockIcon } from '@/components/icons'
import { createClient } from '@/lib/supabase/server'
import { getSessionClaims } from '@/lib/auth/server'
import { requireStaff, resolveEventByCode } from '@/lib/supabase/queries'
import { claimGroupForCall } from '@/lib/actions/call'
import { formatMobile } from '@/lib/phone'
import { formatDateTime } from '@/lib/utils'
import { RsvpLogForm } from './RsvpLogForm'
import { buildInitialFormValues } from '@/lib/rsvp-log'

type PageProps = {
  // Next 15+ hands params and searchParams over as Promises.
  params: Promise<{ eventCode: string; groupId: string }>
  // ?recording=<id> arrives from the review queue when a transcription failed:
  // there is no AI draft, so the caller listens to the audio and types the
  // outcome into this same form. The form itself is unchanged — the manual
  // path is the manual path.
  searchParams: Promise<{ recording?: string; from?: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { groupId } = await params
  return { title: `RSVP — ${groupId.slice(0, 8)}` }
}

export default async function RsvpLogPage({ params, searchParams }: PageProps) {
  const { eventCode, groupId } = await params
  const { recording: recordingId } = await searchParams

  // No getViewer() pre-check: it only understands GoTrue (admin) sessions and
  // returns null for a code-auth team/client session (the cookie store is
  // request-scoped and not visible in this render scope), which would bounce
  // staff to /login. requireStaff() below resolves BOTH session types via the
  // claims, and notFound() is the correct answer for no session.

  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  // Staff only — the form writes guest data, so a client must be turned away
  // before any of it renders.
  await requireStaff(event.id, event.code)

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
          title="Someone else is already logging this family"
          description={
            untilLabel
              ? `The lock releases automatically by ${untilLabel}. Try another family from the queue in the meantime.`
              : 'The lock releases automatically. Try another family from the queue in the meantime.'
          }
        />
      </div>
    )
  }

  const group = claim.group

  // The caller's identity for the "in-flight attempt" match: code sessions
  // have no GoTrue uid — the selected staff member is the identity (recorded
  // in caller_id_staff). Admins use their auth uid (caller_id).
  const claims = await getSessionClaims()
  const callerId = claims?.staffMemberId ?? group.locked_by ?? group.locked_by_staff ?? null

  const supabase = await createClient()
  const [{ data: attempts }, { data: travelLegs }, { data: queue }] = await Promise.all([
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
    // The next family in the queue after this one, using the same sort the
    // queue screen applies: never called first, then fewest attempts, then
    // oldest attempt, then priority. `attempt_count` is computed by the view.
    supabase
      .from('v_rsvp_queue')
      .select('group_id, head_name')
      .eq('event_id', event.id)
      .not('group_id', 'is', null)
      .order('attempt_count', { ascending: true })
      .order('last_attempt_at', { ascending: true })
      .order('priority', { ascending: false })
      .order('head_name', { ascending: true })
      .limit(200),
  ])

  const inFlightAttempt =
    (attempts ?? []).find(
      (a) =>
        a.outcome === null &&
        (a.caller_id === callerId || a.caller_id_staff === callerId),
    ) ?? null

  const queueOrder = (queue ?? [])
    .filter((r) => r.group_id !== null && r.group_id !== groupId)
    .map((r) => r.group_id as string)
  const nextGroupId = queueOrder[0] ?? null

  // Manual-entry mode: the transcription failed, so play her the call.
  // Scoped by event_id AND group_id so a crafted ?recording= cannot pull audio
  // from another family or another event.
  let manualAudioUrl: string | null = null
  if (recordingId) {
    const { data: rec } = await supabase
      .from('call_recordings')
      .select('storage_path, storage_bucket')
      .eq('id', recordingId)
      .eq('event_id', event.id)
      .eq('group_id', groupId)
      .maybeSingle()

    if (rec?.storage_path) {
      const { data: signed } = await supabase.storage
        .from(rec.storage_bucket ?? 'call-recordings')
        .createSignedUrl(rec.storage_path, 3600)
      manualAudioUrl = signed?.signedUrl ?? null
    }
  }

  const form = (
    <RsvpLogForm
      eventId={event.id}
      eventCode={event.code}
      viewerId={callerId ?? ''}
      group={group}
      attempts={attempts ?? []}
      initialValues={buildInitialFormValues(group, travelLegs ?? [], event.starts_on, event.ends_on)}
      inFlightAttempt={inFlightAttempt}
      hasQueueNext={nextGroupId !== null}
    />
  )

  if (!recordingId) return form

  return (
    <div className="flex flex-col gap-4">
      <Card className="border-warning/50 bg-tint-warning">
        <CardBody className="flex flex-col gap-2 py-3">
          <p className="text-sm font-semibold text-warning">
            Transcription failed — enter manually
          </p>
          {manualAudioUrl ? (
            <>
              <p className="text-sm text-muted">
                Listen to the call and type the outcome below. Nothing was transcribed, so
                the form starts from this family&apos;s existing record.
              </p>
              <audio controls src={manualAudioUrl} className="w-full" preload="metadata" />
            </>
          ) : (
            <p className="text-sm text-muted">
              The recording could not be loaded. Log the outcome from memory or call the
              family back — do not leave this call unlogged.
            </p>
          )}
        </CardBody>
      </Card>
      {form}
    </div>
  )
}
