'use client'

import { Card, CardBody } from '@/components/ui/Card'
import { ChevronDownIcon } from '@/components/icons'
import {
  RSVP_STATUS_LABELS,
  SIDE_LABELS,
  TRAVEL_MODE_LABELS,
  type ExistingGroupValues,
  type ExistingLegValues,
  type RsvpStatus,
  type Side,
  type TravelMode,
} from '@/lib/review/payload'
import { formatDate } from '@/lib/utils'

/**
 * Band (a): what the record held before this call. Small and grey on purpose
 * — it is context for the edits below, not something to be read first.
 */

function labelFor<T extends string>(
  value: string | null,
  labels: Record<T, string>,
): string | null {
  if (!value) return null
  return labels[value as T] ?? value
}

function legSummary(leg: ExistingLegValues | null): string | null {
  if (!leg) return null

  const parts = [
    labelFor<TravelMode>(leg.mode, TRAVEL_MODE_LABELS),
    formatDate(leg.date, { day: 'numeric', month: 'short', year: 'numeric' }),
    leg.time ? leg.time.slice(0, 5) : null,
    leg.reference,
    leg.point,
    typeof leg.pax === 'number' ? `${leg.pax} pax` : null,
  ].filter((p): p is string => Boolean(p))

  return parts.length > 0 ? parts.join(' · ') : null
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex gap-2">
      <dt className="w-28 shrink-0 text-subtle">{label}</dt>
      <dd className="min-w-0 flex-1 text-muted">{value ?? '—'}</dd>
    </div>
  )
}

export function BeforeBand({
  group,
  arrival,
  departure,
}: {
  group: ExistingGroupValues
  arrival: ExistingLegValues | null
  departure: ExistingLegValues | null
}) {
  return (
    <Card flat className="border border-dashed border-border">
      <CardBody className="flex flex-col gap-2 py-3">
        <p className="text-xs font-semibold tracking-wide text-subtle uppercase">
          What we had before
        </p>
        <dl className="flex flex-col gap-1 text-xs">
          <Row label="RSVP" value={labelFor<RsvpStatus>(group.rsvpStatus, RSVP_STATUS_LABELS)} />
          <Row
            label="Confirmed pax"
            value={typeof group.confirmedPax === 'number' ? String(group.confirmedPax) : null}
          />
          <Row label="Side" value={labelFor<Side>(group.side, SIDE_LABELS)} />
          <Row label="Arrival" value={legSummary(arrival)} />
          <Row label="Departure" value={legSummary(departure)} />
          <Row label="Remarks" value={group.remarks} />
        </dl>
      </CardBody>
    </Card>
  )
}

/**
 * Band (c): the transcript, collapsed. The reviewer opens this when a field
 * looks wrong and they want to check the wording themselves — so it must be
 * present and one tap away, but never the first thing competing for the
 * screen on a phone.
 */
export function TranscriptPanel({
  transcript,
}: {
  transcript: { text: string; language: string | null; confidence: number | null } | null
}) {
  if (!transcript) {
    return (
      <Card flat className="border border-dashed border-border">
        <CardBody className="py-3 text-sm text-muted">
          No transcript is attached to this extraction. Review the fields above on their own.
        </CardBody>
      </Card>
    )
  }

  const meta = [
    transcript.language ? transcript.language.toUpperCase() : 'Language unknown',
    typeof transcript.confidence === 'number'
      ? `STT ${Math.round(transcript.confidence * 100)}%`
      : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Card>
      <details className="group">
        <summary className="tap flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3">
          <span className="flex flex-col">
            <span className="text-sm font-semibold text-fg">Transcript</span>
            <span className="text-xs text-muted">{meta}</span>
          </span>
          <ChevronDownIcon className="h-5 w-5 shrink-0 text-muted transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-border px-4 py-3">
          <p className="max-h-72 overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap text-fg">
            {transcript.text}
          </p>
        </div>
      </details>
    </Card>
  )
}
