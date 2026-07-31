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

import { ReviewForm } from './ReviewForm'

export const metadata: Metadata = {
  title: 'Review extraction',
}

type PageProps = {
  // Next 15+ hands params over as a Promise.
  params: Promise<{ eventCode: string; extractionId: string }>
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

export default async function ReviewDetailPage({ params }: PageProps) {
  const { eventCode, extractionId } = await params

  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  // Staff only, stated rather than inferred. A client used to end up here on
  // a bare 404 by accident — because the `rsvp_extractions` read happened to
  // return nothing under RLS. That is the right outcome for the wrong reason,
  // and it dropped them outside the shell with no way back. Redirect them to
  // the one page they own instead.
  await requireStaff(event.id, event.code)

  const supabase = await createClient()

  const { data: extraction } = await supabase
    .from('rsvp_extractions')
    .select('*')
    .eq('id', extractionId)
    .eq('event_id', event.id)
    .maybeSingle()

  if (!extraction) notFound()

  const [{ data: group }, { data: legs }] = await Promise.all([
    supabase
      .from('guest_groups')
      .select('id, head_name, primary_mobile, expected_pax, rsvp_status, confirmed_pax, side, remarks')
      .eq('id', extraction.group_id)
      .eq('event_id', event.id)
      .maybeSingle(),
    supabase
      .from('travel_legs')
      .select('id, direction, mode, travel_date, travel_time, reference, point, pax_on_leg, created_at')
      .eq('group_id', extraction.group_id)
      .eq('event_id', event.id)
      .order('created_at', { ascending: true }),
  ])

  // The group row can legitimately be missing under RLS (e.g. it was
  // reassigned to another event, or your role changed) — treat it the same
  // as "not found" rather than rendering a form with nothing behind it.
  if (!group) notFound()

  let transcript: { text: string; language: string | null; confidence: number | null } | null = null
  if (extraction.transcript_id) {
    const { data: t } = await supabase
      .from('transcripts')
      .select('text, language, confidence')
      .eq('id', extraction.transcript_id)
      .eq('event_id', event.id)
      .maybeSingle()
    transcript = t ?? null
  }

  const arrivalLegs = (legs ?? []).filter((l) => l.direction === 'arrival')
  const departureLegs = (legs ?? []).filter((l) => l.direction === 'departure')

  const existingGroup: ExistingGroupValues = {
    rsvpStatus: group.rsvp_status,
    confirmedPax: group.confirmed_pax,
    side: group.side,
    remarks: group.remarks,
  }
  const existingArrival = toExistingLeg(arrivalLegs[0] ?? null)
  const existingDeparture = toExistingLeg(departureLegs[0] ?? null)

  const parsed = parseExtractionPayload(extraction.parsed)
  const initialValues = buildInitialFormValues(parsed, existingGroup, existingArrival, existingDeparture)

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={`/${event.code}/review`}
        className="tap -ml-2 inline-flex w-fit items-center gap-1 rounded-xl px-2 py-1.5 text-sm font-medium text-muted hover:bg-surface-2 hover:text-fg"
      >
        <ChevronLeftIcon className="h-5 w-5" />
        Review queue
      </Link>

      <ReviewForm
        eventCode={event.code}
        extractionId={extraction.id}
        extractionStatus={extraction.status}
        reviewedAt={extraction.reviewed_at}
        reviewNotes={extraction.review_notes}
        headName={group.head_name}
        primaryMobile={group.primary_mobile}
        expectedPax={group.expected_pax}
        confidence={extraction.confidence}
        transcript={transcript}
        initialValues={initialValues}
        existingGroup={existingGroup}
        existingArrival={existingArrival}
        existingDeparture={existingDeparture}
        arrivalLegCount={arrivalLegs.length}
        departureLegCount={departureLegs.length}
      />
    </div>
  )
}
