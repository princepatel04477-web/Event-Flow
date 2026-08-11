import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { ChevronLeftIcon } from '@/components/icons'
import { createClient } from '@/lib/supabase/server'
import { requireStaff, resolveEventByCode } from '@/lib/supabase/queries'
import {
  RSVP_STATUS_LABELS,
  RSVP_STATUS_OPTIONS,
  SIDE_LABELS,
  SIDE_OPTIONS,
  TRAVEL_MODE_LABELS,
  TRAVEL_MODE_OPTIONS,
  buildInitialFormValues,
  parseExtractionPayload,
  type ExistingGroupValues,
  type ExistingLegValues,
} from '@/lib/review/payload'
import {
  ReviewPanel,
  type ReviewFieldDef,
  type ReviewPanelProps,
  type TranscriptSegment,
} from '@/components/review/ReviewPanel'

export const metadata: Metadata = {
  title: 'Review extraction',
}

type PageProps = {
  // Next 15+ hands params and searchParams over as Promises.
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

/**
 * Build the ordered field definitions for the review panel.
 *
 * `path` is the FORM key — it must match the panel's fieldValueMap and
 * buildRpcPayload (rsvpStatus, confirmedPax, remarks, arrival.mode, ...).
 * `modelPath` is the model's dotted key (rsvp_status, special_requests,
 * arrival.mode, ...) used for confidence + evidence lookup and the audit
 * trail's field_name. The two differ for exactly the renamed fields.
 */
function buildFieldDefs(
  parsed: ReturnType<typeof parseExtractionPayload>,
): ReviewFieldDef[] {
  const labelFor = (path: string): string => {
    switch (path) {
      case 'rsvpStatus':
        return 'RSVP status'
      case 'confirmedPax':
        return 'Confirmed pax'
      case 'side':
        return 'Side'
      case 'remarks':
        return 'Remarks'
      default: {
        const parts = path.split('.')
        const dir = parts[0] === 'arrival' ? 'Arrival' : 'Departure'
        const field = parts[1] ?? ''
        const names: Record<string, string> = {
          mode: 'Mode',
          date: 'Date',
          time: 'Time',
          reference: 'Flight / train no',
          point: 'Point',
          pax: 'Pax',
        }
        return `${dir} ${names[field] ?? field}`
      }
    }
  }

  const kindFor = (path: string): ReviewFieldDef['kind'] => {
    switch (path) {
      case 'rsvpStatus':
      case 'side':
        return 'select'
      case 'confirmedPax':
        return 'number'
      case 'remarks':
        return 'textarea'
      default: {
        const field = path.split('.')[1]
        if (field === 'pax') return 'number'
        if (field === 'date') return 'date'
        if (field === 'time') return 'time'
        return 'text'
      }
    }
  }

  const aiDisplayFor = (path: string): string => {
    switch (path) {
      case 'rsvpStatus':
        return parsed.rsvp_status ?? ''
      case 'confirmedPax':
        return parsed.confirmed_pax != null ? String(parsed.confirmed_pax) : ''
      case 'side':
        // The model does not emit side — reviewer-supplied, prefilled from
        // the group's current value by buildInitialFormValues.
        return ''
      case 'remarks':
        return parsed.special_requests ?? ''
      default: {
        const [dir, field] = path.split('.') as ['arrival' | 'departure', string]
        const leg = parsed[dir]
        if (!leg) return ''
        const v = leg[field as keyof typeof leg]
        return v != null ? String(v) : ''
      }
    }
  }

  const aiJsonFor = (path: string): unknown => {
    switch (path) {
      case 'rsvpStatus':
        return parsed.rsvp_status
      case 'confirmedPax':
        return parsed.confirmed_pax
      case 'side':
        return null
      case 'remarks':
        return parsed.special_requests
      default: {
        const [dir, field] = path.split('.') as ['arrival' | 'departure', string]
        const leg = parsed[dir]
        return leg ? (leg[field as keyof typeof leg] ?? null) : null
      }
    }
  }

  const defs: ReviewFieldDef[] = []

  // Top-level fields, in a stable review order. The model may have omitted
  // some — we still surface the field so the reviewer can decide it.
  const topLevel: Array<{ path: string; modelPath: string }> = [
    { path: 'rsvpStatus', modelPath: 'rsvp_status' },
    { path: 'confirmedPax', modelPath: 'confirmed_pax' },
    { path: 'side', modelPath: 'side' },
    { path: 'remarks', modelPath: 'special_requests' },
  ]
  for (const { path, modelPath } of topLevel) {
    defs.push({
      path,
      modelPath,
      label: labelFor(path),
      kind: kindFor(path),
      aiDisplay: aiDisplayFor(path),
      aiJson: aiJsonFor(path),
      options:
        path === 'rsvpStatus'
          ? RSVP_STATUS_OPTIONS.map((v) => ({ value: v, label: RSVP_STATUS_LABELS[v] }))
          : path === 'side'
            ? SIDE_OPTIONS.map((v) => ({ value: v, label: SIDE_LABELS[v] }))
            : undefined,
    })
  }

  // Travel legs.
  for (const dir of ['arrival', 'departure'] as const) {
    const subfields: Array<{ path: string; modelPath: string }> = [
      { path: 'mode', modelPath: 'mode' },
      { path: 'date', modelPath: 'date' },
      { path: 'time', modelPath: 'time' },
      { path: 'reference', modelPath: 'reference' },
      { path: 'point', modelPath: 'point' },
      { path: 'pax', modelPath: 'pax' },
    ]
    for (const { path, modelPath } of subfields) {
      const full = `${dir}.${path}`
      defs.push({
        path: full,
        modelPath: `${dir}.${modelPath}`,
        label: labelFor(full),
        kind: kindFor(full),
        aiDisplay: aiDisplayFor(full),
        aiJson: aiJsonFor(full),
        options:
          path === 'mode'
            ? TRAVEL_MODE_OPTIONS.map((v) => ({ value: v, label: TRAVEL_MODE_LABELS[v] }))
            : undefined,
      })
    }
  }

  return defs
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

  // Transcript + segments. The old shape (text/language/confidence) still
  // exists; the A0 shape (full_text + segments) is read when present.
  let transcriptText: string | null = null
  let transcriptSegments: TranscriptSegment[] | null = null
  let audioUrl: string | null = null
  if (extraction.transcript_id) {
    const { data: t } = await supabase
      .from('transcripts')
      .select('text, full_text, segments, recording_id')
      .eq('id', extraction.transcript_id)
      .eq('event_id', event.id)
      .maybeSingle()
    if (t) {
      transcriptText = t.full_text ?? t.text ?? null
      if (Array.isArray(t.segments) && t.segments.length > 0) {
        transcriptSegments = (t.segments as unknown[]).map((raw) => {
          const s = raw as Record<string, unknown>
          return {
            speaker: String(s.speaker ?? 'staff'),
            startMs: typeof s.start_ms === 'number' ? s.start_ms : 0,
            endMs: typeof s.end_ms === 'number' ? s.end_ms : 0,
            text: String(s.text ?? ''),
          }
        })
      }
      // A signed URL for the recording, when the pipeline has uploaded one.
      if (t.recording_id) {
        const { data: rec } = await supabase
          .from('call_recordings')
          .select('storage_path')
          .eq('id', t.recording_id)
          .eq('event_id', event.id)
          .maybeSingle()
        if (rec?.storage_path) {
          const { data: signed } = await supabase.storage
            .from('call-recordings')
            .createSignedUrl(rec.storage_path, 3600)
          audioUrl = signed?.signedUrl ?? null
        }
      }
    }
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

  const fields = buildFieldDefs(parsed)

  // Evidence map: fields.json (the A0 per-field shape) carries evidence
  // substrings + ms offsets, keyed by the MODEL's dotted path. Fall back to
  // empty per-field evidence when the extraction predates it.
  const fieldsJson = (extraction.fields ?? null) as Record<string, unknown> | null
  const fieldEvidence: ReviewPanelProps['fieldEvidence'] = {}
  for (const f of fields) {
    const key = f.modelPath ?? f.path
    const entry = fieldsJson?.[key] as Record<string, unknown> | undefined
    fieldEvidence[key] = {
      startMs: typeof entry?.evidence_start_ms === 'number' ? entry.evidence_start_ms : null,
      endMs: typeof entry?.evidence_end_ms === 'number' ? entry.evidence_end_ms : null,
      quote: typeof entry?.evidence === 'string' ? entry.evidence : null,
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={`/${event.code}/review`}
        className="tap -ml-2 inline-flex w-fit items-center gap-1 rounded-xl px-2 py-1.5 text-sm font-medium text-muted hover:bg-surface-2 hover:text-fg"
      >
        <ChevronLeftIcon className="h-5 w-5" />
        Review queue
      </Link>

      <ReviewPanel
        eventCode={event.code}
        extractionId={extraction.id}
        headName={group.head_name}
        primaryMobile={group.primary_mobile}
        side={group.side}
        expectedPax={group.expected_pax}
        fields={fields}
        fieldEvidence={fieldEvidence}
        values={initialValues}
        existingGroup={existingGroup}
        existingArrival={existingArrival}
        existingDeparture={existingDeparture}
        audio={audioUrl ? { url: audioUrl } : null}
        transcriptText={transcriptText}
        transcriptSegments={transcriptSegments}
        confidence={extraction.confidence}
      />
    </div>
  )
}
