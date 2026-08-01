import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { ChevronLeftIcon } from '@/components/icons'
import { createClient } from '@/lib/supabase/server'
import { requireStaff, resolveEventByCode } from '@/lib/supabase/queries'
import {
  buildInitialFormValues,
  parseExtractionPayload,
  type ExistingGroupValues,
  type ExistingLegValues,
} from '@/lib/review/payload'

import { ManualForm } from './ManualForm'

export const metadata: Metadata = {
  title: 'Enter RSVP manually',
}

type PageProps = {
  params: Promise<{ eventCode: string; groupId: string }>
  searchParams: Promise<{ from?: string }>
}

function toExistingLeg(leg: {
  mode: string | null
  travel_date: string | null
  travel_time: string | null
  reference: string | null
  point: string | null
  pax_on_leg: number | null
} | null): ExistingLegValues | null {
  if (!leg) return null
  return {
    mode: leg.mode,
    date: leg.travel_date,
    time: leg.travel_time,
    reference: leg.reference,
    point: leg.point,
    pax: leg.pax_on_leg,
  }
}

export default async function ManualEntryPage({ params, searchParams }: PageProps) {
  const { eventCode, groupId } = await params
  const { from } = await searchParams

  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  await requireStaff(event.id, event.code)

  const supabase = await createClient()

  const [{ data: group }, { data: legs }] = await Promise.all([
    supabase
      .from('guest_groups')
      .select('id, head_name, rsvp_status, confirmed_pax, side, remarks')
      .eq('id', groupId)
      .eq('event_id', event.id)
      .maybeSingle(),
    supabase
      .from('travel_legs')
      .select('direction, mode, travel_date, travel_time, reference, point, pax_on_leg, created_at')
      .eq('group_id', groupId)
      .eq('event_id', event.id)
      .order('created_at', { ascending: true }),
  ])

  if (!group) notFound()

  const existingGroup: ExistingGroupValues = {
    rsvpStatus: group.rsvp_status,
    confirmedPax: group.confirmed_pax,
    side: group.side,
    remarks: group.remarks,
  }
  const existingArrival = toExistingLeg((legs ?? []).find((l) => l.direction === 'arrival') ?? null)
  const existingDeparture = toExistingLeg(
    (legs ?? []).find((l) => l.direction === 'departure') ?? null,
  )

  // No extraction to draw from — every field starts at whatever the record
  // already holds, which `buildInitialFormValues` gives us for free when the
  // parsed payload is empty.
  const initialValues = buildInitialFormValues(
    parseExtractionPayload(null),
    existingGroup,
    existingArrival,
    existingDeparture,
  )

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={`/${event.code}/queue`}
        className="tap -ml-2 inline-flex w-fit items-center gap-1 rounded-xl px-2 py-1.5 text-sm font-medium text-muted hover:bg-surface-2 hover:text-fg"
      >
        <ChevronLeftIcon className="h-5 w-5" />
        Queue
      </Link>

      <ManualForm
        eventCode={event.code}
        eventId={event.id}
        groupId={group.id}
        headName={group.head_name}
        cameFromReview={from === 'review'}
        initialValues={initialValues}
        existingGroup={existingGroup}
        existingArrival={existingArrival}
        existingDeparture={existingDeparture}
      />
    </div>
  )
}
