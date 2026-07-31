'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import { acceptExtraction, rejectExtraction } from '@/lib/actions/review'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { PhoneIcon, ShieldAlertIcon } from '@/components/icons'
import { CONFIDENCE_PATHS, getConfidence, LOW_CONFIDENCE_THRESHOLD } from '@/lib/review/confidence'
import {
  RSVP_STATUS_LABELS,
  RSVP_STATUS_OPTIONS,
  SIDE_LABELS,
  SIDE_OPTIONS,
  TRAVEL_MODE_LABELS,
  TRAVEL_MODE_OPTIONS,
  buildRpcPayload,
  detectClearAttempts,
  type ClearAttempt,
  type ExistingGroupValues,
  type ExistingLegValues,
  type LegFormValues,
  type ReviewFormValues,
} from '@/lib/review/payload'
import type { Database } from '@/lib/supabase/database.types'

type ExtractionStatus = Database['app']['Enums']['extraction_status']

export interface ReviewFormProps {
  eventCode: string
  extractionId: string
  extractionStatus: ExtractionStatus
  reviewedAt: string | null
  reviewNotes: string | null
  headName: string
  primaryMobile: string | null
  expectedPax: number
  confidence: unknown
  transcript: { text: string; language: string | null; confidence: number | null } | null
  initialValues: ReviewFormValues
  existingGroup: ExistingGroupValues
  existingArrival: ExistingLegValues | null
  existingDeparture: ExistingLegValues | null
  arrivalLegCount: number
  departureLegCount: number
}

/** Small amber/neutral confidence chip rendered next to a field label. */
function ConfidenceBadge({ path, confidence }: { path: string; confidence: unknown }) {
  const value = getConfidence(confidence, path)
  if (value === null) return null
  const low = value < LOW_CONFIDENCE_THRESHOLD
  return (
    <Badge tone={low ? 'warning' : 'neutral'} size="sm" className="font-mono">
      {low ? <ShieldAlertIcon className="h-3 w-3" /> : null}
      {Math.round(value * 100)}%
    </Badge>
  )
}

function LowConfidenceNote({ path, confidence }: { path: string; confidence: unknown }) {
  const value = getConfidence(confidence, path)
  if (value === null || value >= LOW_CONFIDENCE_THRESHOLD) return null
  return (
    <p className="mt-1 flex items-center gap-1 text-xs font-medium text-warning">
      <ShieldAlertIcon className="h-3.5 w-3.5 shrink-0" />
      Low confidence — check this against the transcript before accepting.
    </p>
  )
}

function ClearAttemptNote({ attempt }: { attempt: ClearAttempt | undefined }) {
  if (!attempt) return null
  return (
    <p className="mt-1 text-xs font-medium text-danger">
      Clearing isn&apos;t supported yet — this will stay &ldquo;{attempt.existingValue}&rdquo; unless
      you type a new value.
    </p>
  )
}

export function ReviewForm({
  eventCode,
  extractionId,
  extractionStatus,
  reviewedAt,
  reviewNotes,
  headName,
  primaryMobile,
  expectedPax,
  confidence,
  transcript,
  initialValues,
  existingGroup,
  existingArrival,
  existingDeparture,
  arrivalLegCount,
  departureLegCount,
}: ReviewFormProps) {
  const router = useRouter()

  const [values, setValues] = useState<ReviewFormValues>(initialValues)
  const [notes, setNotes] = useState('')
  const [pendingAction, setPendingAction] = useState<'accept' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const clearAttempts = useMemo(
    () => detectClearAttempts(values, existingGroup, existingArrival, existingDeparture),
    [values, existingGroup, existingArrival, existingDeparture],
  )
  const clearAttemptByField = useMemo(() => {
    const map = new Map<string, ClearAttempt>()
    for (const a of clearAttempts) map.set(a.field, a)
    return map
  }, [clearAttempts])

  const alreadyApplied = extractionStatus === 'accepted'
  const wasRejected = extractionStatus === 'rejected'
  const isBusy = pendingAction !== null

  function updateField<K extends keyof ReviewFormValues>(key: K, value: ReviewFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  function updateLeg(direction: 'arrival' | 'departure', field: keyof LegFormValues, value: string) {
    setValues((prev) => ({
      ...prev,
      [direction]: { ...prev[direction], [field]: value },
    }))
  }

  async function handleAccept() {
    if (alreadyApplied || clearAttempts.length > 0) return
    setError(null)
    setPendingAction('accept')

    const payload = buildRpcPayload(values)
    const result = await acceptExtraction(eventCode, extractionId, payload)

    if (!result.ok) {
      setError(result.error)
      setPendingAction(null)
      return
    }

    router.push(`/${eventCode}/review?done=accepted`)
  }

  async function handleReject() {
    if (alreadyApplied) return
    setError(null)
    setPendingAction('reject')

    const result = await rejectExtraction(eventCode, extractionId, notes)

    if (!result.ok) {
      setError(result.error)
      setPendingAction(null)
      return
    }

    router.push(`/${eventCode}/review?done=rejected`)
  }

  return (
    <div className="flex flex-col gap-4 pb-4">
      <Card>
        <CardBody className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-fg">{headName}</h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            {primaryMobile ? (
              <span className="inline-flex items-center gap-1">
                <PhoneIcon className="h-3.5 w-3.5" />
                {primaryMobile}
              </span>
            ) : null}
            <span>Expected pax: {expectedPax}</span>
          </div>
        </CardBody>
      </Card>

      {alreadyApplied ? (
        <Card className="border-success/40 bg-tint-success">
          <CardBody className="py-3 text-sm text-success">
            <p className="font-semibold">Already applied.</p>
            <p className="mt-0.5">
              This extraction was accepted{reviewedAt ? ` on ${new Date(reviewedAt).toLocaleString('en-IN')}` : ''}
              . apply_rsvp_extraction() refuses to re-apply an accepted extraction, so editing here
              cannot do anything further — go to the group directly for any further changes.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {wasRejected ? (
        <Card className="border-border-strong bg-surface-2">
          <CardBody className="py-3 text-sm text-fg">
            <p className="font-semibold">Previously rejected.</p>
            {reviewNotes ? <p className="mt-0.5 text-muted">Reason: {reviewNotes}</p> : null}
            <p className="mt-0.5 text-muted">
              A rejected extraction can still be applied — the database does not block that. Review
              carefully before accepting.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {arrivalLegCount > 1 ? (
        <LegCountWarning direction="arrival" count={arrivalLegCount} />
      ) : null}
      {departureLegCount > 1 ? (
        <LegCountWarning direction="departure" count={departureLegCount} />
      ) : null}

      {transcript ? (
        <Card>
          <CardHeader>
            <CardTitle>
              <p className="font-semibold text-fg">Transcript</p>
              <p className="text-xs text-muted">
                {transcript.language ? transcript.language.toUpperCase() : 'Language unknown'}
                {typeof transcript.confidence === 'number'
                  ? ` · STT confidence ${Math.round(transcript.confidence * 100)}%`
                  : ''}
              </p>
            </CardTitle>
          </CardHeader>
          <CardBody>
            <p className="max-h-56 overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap text-fg">
              {transcript.text}
            </p>
          </CardBody>
        </Card>
      ) : (
        <Card flat className="border border-dashed border-border">
          <CardBody className="py-3 text-sm text-muted">
            No transcript is attached to this extraction. Review the fields below on their own.
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <p className="font-semibold text-fg">RSVP</p>
          </CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          <div>
            <Select
              label={
                <span className="inline-flex items-center gap-2">
                  RSVP status
                  <ConfidenceBadge path={CONFIDENCE_PATHS.rsvpStatus} confidence={confidence} />
                </span>
              }
              value={values.rsvpStatus}
              onChange={(e) => updateField('rsvpStatus', e.target.value)}
              disabled={alreadyApplied}
              placeholder="Not set"
              options={RSVP_STATUS_OPTIONS.map((v) => ({ value: v, label: RSVP_STATUS_LABELS[v] }))}
            />
            <LowConfidenceNote path={CONFIDENCE_PATHS.rsvpStatus} confidence={confidence} />
            <ClearAttemptNote attempt={clearAttemptByField.get('rsvpStatus')} />
          </div>

          <div>
            <Input
              label={
                <span className="inline-flex items-center gap-2">
                  Confirmed pax
                  <ConfidenceBadge path={CONFIDENCE_PATHS.confirmedPax} confidence={confidence} />
                </span>
              }
              type="number"
              inputMode="numeric"
              min={0}
              value={values.confirmedPax}
              onChange={(e) => updateField('confirmedPax', e.target.value)}
              disabled={alreadyApplied}
            />
            <LowConfidenceNote path={CONFIDENCE_PATHS.confirmedPax} confidence={confidence} />
            <ClearAttemptNote attempt={clearAttemptByField.get('confirmedPax')} />
          </div>

          <div>
            <Select
              label="Side"
              hint="Not captured by the AI — set this yourself if you know it."
              value={values.side}
              onChange={(e) => updateField('side', e.target.value)}
              disabled={alreadyApplied}
              placeholder="Not set"
              options={SIDE_OPTIONS.map((v) => ({ value: v, label: SIDE_LABELS[v] }))}
            />
            <ClearAttemptNote attempt={clearAttemptByField.get('side')} />
          </div>

          <div>
            <Textarea
              label={
                <span className="inline-flex items-center gap-2">
                  Remarks
                  <ConfidenceBadge path={CONFIDENCE_PATHS.remarks} confidence={confidence} />
                </span>
              }
              hint="Mapped from the AI's special_requests field onto guest_groups.remarks."
              value={values.remarks}
              onChange={(e) => updateField('remarks', e.target.value)}
              disabled={alreadyApplied}
              rows={3}
            />
            <LowConfidenceNote path={CONFIDENCE_PATHS.remarks} confidence={confidence} />
            <ClearAttemptNote attempt={clearAttemptByField.get('remarks')} />
          </div>
        </CardBody>
      </Card>

      <LegCard
        title="Arrival"
        direction="arrival"
        values={values.arrival}
        confidence={confidence}
        disabled={alreadyApplied}
        clearAttemptByField={clearAttemptByField}
        onChange={(field, value) => updateLeg('arrival', field, value)}
      />

      <LegCard
        title="Departure"
        direction="departure"
        values={values.departure}
        confidence={confidence}
        disabled={alreadyApplied}
        clearAttemptByField={clearAttemptByField}
        onChange={(field, value) => updateLeg('departure', field, value)}
      />

      {clearAttempts.length > 0 ? (
        <Card className="border-danger/40 bg-tint-danger">
          <CardBody className="py-3 text-sm text-danger">
            <p className="font-semibold">
              {clearAttempts.length} field{clearAttempts.length === 1 ? '' : 's'} can&apos;t be cleared
              this way.
            </p>
            <p className="mt-0.5">
              apply_rsvp_extraction() keeps the existing value whenever a field is left blank — there
              is no way to null a field out through this screen. Either type a replacement value, or
              restore what was there before, for each field flagged above.
            </p>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            <p className="font-semibold text-fg">Decision</p>
          </CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          <div>
            <Textarea
              label="Reason for rejection"
              hint="Only used if you reject. Ignored on accept."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={alreadyApplied}
              rows={2}
            />
          </div>

          {error ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          ) : null}

          <div className="flex flex-col gap-2">
            <Button
              size="lg"
              fullWidth
              onClick={handleAccept}
              loading={pendingAction === 'accept'}
              disabled={alreadyApplied || clearAttempts.length > 0 || isBusy}
            >
              Accept &amp; apply
            </Button>
            <Button
              size="lg"
              variant="danger"
              fullWidth
              onClick={handleReject}
              loading={pendingAction === 'reject'}
              disabled={alreadyApplied || isBusy}
            >
              Reject
            </Button>
          </div>

          {clearAttempts.length > 0 ? (
            <p className="text-xs text-subtle">
              Accept is disabled while a cleared field above would silently keep its old value.
            </p>
          ) : null}
        </CardBody>
      </Card>
    </div>
  )
}

function LegCountWarning({ direction, count }: { direction: 'arrival' | 'departure'; count: number }) {
  return (
    <Card className="border-warning/40 bg-tint-warning">
      <CardBody className="py-3 text-sm text-warning">
        <p className="font-semibold">
          {count} {direction} legs on file.
        </p>
        <p className="mt-0.5">
          apply_rsvp_extraction() only ever edits the oldest {direction} leg (first one added). Any
          later {direction} leg for this group will not change here — edit it directly if it needs
          fixing.
        </p>
      </CardBody>
    </Card>
  )
}

function LegCard({
  title,
  direction,
  values,
  confidence,
  disabled,
  clearAttemptByField,
  onChange,
}: {
  title: string
  direction: 'arrival' | 'departure'
  values: LegFormValues
  confidence: unknown
  disabled: boolean
  clearAttemptByField: Map<string, ClearAttempt>
  onChange: (field: keyof LegFormValues, value: string) => void
}) {
  const path = (field: string) => CONFIDENCE_PATHS[`${direction}.${field}`]
  const clearKey = (field: string) => `${direction}.${field}`

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <p className="font-semibold text-fg">{title}</p>
        </CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        <div>
          <Select
            label={
              <span className="inline-flex items-center gap-2">
                Mode
                <ConfidenceBadge path={path('mode')} confidence={confidence} />
              </span>
            }
            value={values.mode}
            onChange={(e) => onChange('mode', e.target.value)}
            disabled={disabled}
            placeholder="Not set"
            options={TRAVEL_MODE_OPTIONS.map((v) => ({ value: v, label: TRAVEL_MODE_LABELS[v] }))}
          />
          <LowConfidenceNote path={path('mode')} confidence={confidence} />
          <ClearAttemptNote attempt={clearAttemptByField.get(clearKey('mode'))} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Input
              label={
                <span className="inline-flex items-center gap-2">
                  Date
                  <ConfidenceBadge path={path('date')} confidence={confidence} />
                </span>
              }
              type="date"
              value={values.date}
              onChange={(e) => onChange('date', e.target.value)}
              disabled={disabled}
            />
            <LowConfidenceNote path={path('date')} confidence={confidence} />
            <ClearAttemptNote attempt={clearAttemptByField.get(clearKey('date'))} />
          </div>
          <div>
            <Input
              label={
                <span className="inline-flex items-center gap-2">
                  Time
                  <ConfidenceBadge path={path('time')} confidence={confidence} />
                </span>
              }
              type="time"
              value={values.time}
              onChange={(e) => onChange('time', e.target.value)}
              disabled={disabled}
            />
            <LowConfidenceNote path={path('time')} confidence={confidence} />
            <ClearAttemptNote attempt={clearAttemptByField.get(clearKey('time'))} />
          </div>
        </div>

        <div>
          <Input
            label={
              <span className="inline-flex items-center gap-2">
                Reference
                <ConfidenceBadge path={path('reference')} confidence={confidence} />
              </span>
            }
            hint="Flight / train number, PNR — whatever was actually said."
            value={values.reference}
            onChange={(e) => onChange('reference', e.target.value)}
            disabled={disabled}
          />
          <LowConfidenceNote path={path('reference')} confidence={confidence} />
          <ClearAttemptNote attempt={clearAttemptByField.get(clearKey('reference'))} />
        </div>

        <div>
          <Input
            label={
              <span className="inline-flex items-center gap-2">
                Point
                <ConfidenceBadge path={path('point')} confidence={confidence} />
              </span>
            }
            hint="Airport, station, or pickup/drop location."
            value={values.point}
            onChange={(e) => onChange('point', e.target.value)}
            disabled={disabled}
          />
          <LowConfidenceNote path={path('point')} confidence={confidence} />
          <ClearAttemptNote attempt={clearAttemptByField.get(clearKey('point'))} />
        </div>

        <div>
          <Input
            label={
              <span className="inline-flex items-center gap-2">
                Pax on this leg
                <ConfidenceBadge path={path('pax')} confidence={confidence} />
              </span>
            }
            type="number"
            inputMode="numeric"
            min={0}
            value={values.pax}
            onChange={(e) => onChange('pax', e.target.value)}
            disabled={disabled}
          />
          <LowConfidenceNote path={path('pax')} confidence={confidence} />
          <ClearAttemptNote attempt={clearAttemptByField.get(clearKey('pax'))} />
        </div>
      </CardBody>
    </Card>
  )
}

export default ReviewForm
