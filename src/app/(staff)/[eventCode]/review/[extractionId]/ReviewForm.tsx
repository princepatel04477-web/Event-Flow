'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import { acceptExtraction, rejectExtraction } from '@/lib/actions/review'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { PhoneIcon } from '@/components/icons'
import {
  RSVP_STATUS_LABELS,
  RSVP_STATUS_OPTIONS,
  SIDE_LABELS,
  SIDE_OPTIONS,
  TRAVEL_MODE_LABELS,
  TRAVEL_MODE_OPTIONS,
  buildRpcPayload,
  detectClearAttempts,
  detectInvalidNumbers,
  detectMissingConfirmedPax,
  detectUnresolvedUnclear,
  setFormValue,
  type ClearAttempt,
  type FieldKey,
  type FieldStates,
  type InvalidNumber,
  type ExistingGroupValues,
  type ExistingLegValues,
  type ReviewFormValues,
  type RsvpStatus,
  type Side,
  type TravelMode,
} from '@/lib/review/payload'
import { formatMobile } from '@/lib/phone'
import { formatDate, formatDateTime } from '@/lib/utils'
import type { Database } from '@/lib/supabase/database.types'

import { BeforeBand, TranscriptPanel } from './ReviewBands'
import { FieldLabel, ReviewField } from './ReviewField'

type ExtractionStatus = Database['app']['Enums']['extraction_status']

export interface ReviewFormProps {
  eventCode: string
  groupId: string
  extractionId: string
  extractionStatus: ExtractionStatus
  reviewedAt: string | null
  reviewedByName: string | null
  reviewNotes: string | null
  headName: string
  primaryMobile: string | null
  expectedPax: number
  transcript: { text: string; language: string | null; confidence: number | null } | null
  fieldStates: FieldStates
  initialValues: ReviewFormValues
  existingGroup: ExistingGroupValues
  existingArrival: ExistingLegValues | null
  existingDeparture: ExistingLegValues | null
  arrivalLegCount: number
  departureLegCount: number
}

const labelFormatter =
  <T extends string>(labels: Record<T, string>) =>
  (value: string) =>
    labels[value as T] ?? value

const formatRsvp = labelFormatter<RsvpStatus>(RSVP_STATUS_LABELS)
const formatSide = labelFormatter<Side>(SIDE_LABELS)
const formatMode = labelFormatter<TravelMode>(TRAVEL_MODE_LABELS)
const formatDay = (value: string) =>
  formatDate(value, { day: 'numeric', month: 'short', year: 'numeric' }) ?? value

function InvalidNumberNote({ invalid }: { invalid: InvalidNumber | undefined }) {
  if (!invalid) return null
  return (
    <p className="mt-1 text-xs font-medium text-danger">
      &ldquo;{invalid.raw}&rdquo; is not a whole number of people. Type a whole number — a decimal
      would be silently rounded down.
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
  groupId,
  extractionId,
  extractionStatus,
  reviewedAt,
  reviewedByName,
  reviewNotes,
  headName,
  primaryMobile,
  expectedPax,
  transcript,
  fieldStates,
  initialValues,
  existingGroup,
  existingArrival,
  existingDeparture,
  arrivalLegCount,
  departureLegCount,
}: ReviewFormProps) {
  const router = useRouter()

  const [values, setValues] = useState<ReviewFormValues>(initialValues)
  const [acknowledged, setAcknowledged] = useState<ReadonlySet<string>>(new Set())
  const [notes, setNotes] = useState('')
  const [pendingAction, setPendingAction] = useState<'accept' | 'discard' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const alreadyApplied = extractionStatus === 'accepted'
  const wasRejected = extractionStatus === 'rejected'
  const isBusy = pendingAction !== null

  const clearAttempts = useMemo(
    () => detectClearAttempts(values, existingGroup, existingArrival, existingDeparture),
    [values, existingGroup, existingArrival, existingDeparture],
  )
  const clearAttemptByField = useMemo(
    () => new Map(clearAttempts.map((a) => [a.field, a])),
    [clearAttempts],
  )

  const invalidNumbers = useMemo(() => detectInvalidNumbers(values), [values])
  const invalidByField = useMemo(
    () => new Map(invalidNumbers.map((n) => [n.field, n])),
    [invalidNumbers],
  )

  const unresolved = useMemo(
    () => detectUnresolvedUnclear(values, fieldStates, acknowledged),
    [values, fieldStates, acknowledged],
  )
  const missingPax = useMemo(() => detectMissingConfirmedPax(values), [values])

  const blocked =
    alreadyApplied ||
    clearAttempts.length > 0 ||
    invalidNumbers.length > 0 ||
    unresolved.length > 0 ||
    missingPax

  const update = useCallback((key: FieldKey, value: string) => {
    setValues((prev) => setFormValue(prev, key, value))
  }, [])

  const acknowledge = useCallback((key: FieldKey, next: boolean) => {
    setAcknowledged((prev) => {
      const copy = new Set(prev)
      if (next) copy.add(key)
      else copy.delete(key)
      return copy
    })
  }, [])

  async function handleAccept() {
    if (blocked) return
    setError(null)
    setPendingAction('accept')

    // What the human approved, not what the model said.
    const result = await acceptExtraction(eventCode, extractionId, buildRpcPayload(values))

    if (!result.ok) {
      setError(result.error)
      setPendingAction(null)
      return
    }

    router.push(`/${eventCode}/queue?done=applied`)
  }

  async function handleDiscard() {
    if (alreadyApplied) return
    setError(null)
    setPendingAction('discard')

    const result = await rejectExtraction(eventCode, extractionId, notes)

    if (!result.ok) {
      setError(result.error)
      setPendingAction(null)
      return
    }

    // Rejecting writes nothing to guest data — hand straight over to the
    // manual form so the caller can type what was actually said.
    router.push(`/${eventCode}/call/${groupId}/manual?from=review`)
  }

  /** Shared props for every field, so the guard wiring is written once. */
  const fieldProps = (key: FieldKey) => ({
    state: fieldStates[key],
    acknowledged: acknowledged.has(key),
    onAcknowledge: (next: boolean) => acknowledge(key, next),
    disabled: alreadyApplied,
    notes: (
      <>
        <InvalidNumberNote invalid={invalidByField.get(key)} />
        <ClearAttemptNote attempt={clearAttemptByField.get(key)} />
      </>
    ),
  })

  return (
    <div className="flex flex-col gap-4 pb-4">
      <Card>
        <CardBody className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-fg">{headName}</h2>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            {primaryMobile ? (
              <span className="inline-flex items-center gap-1">
                <PhoneIcon className="h-3.5 w-3.5" />
                {formatMobile(primaryMobile)}
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
              Approved by {reviewedByName ?? 'an unknown reviewer'}
              {reviewedAt ? ` on ${formatDateTime(reviewedAt)}` : ''}. This screen is read-only —
              an applied extraction cannot be applied twice. Go to the group directly for any
              further changes.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {wasRejected ? (
        <Card className="border-border-strong bg-surface-2">
          <CardBody className="py-3 text-sm text-fg">
            <p className="font-semibold">Previously discarded.</p>
            {reviewNotes ? <p className="mt-0.5 text-muted">Reason: {reviewNotes}</p> : null}
            <p className="mt-0.5 text-muted">
              A discarded extraction can still be applied — the database does not block that.
              Review carefully before saving.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {arrivalLegCount > 1 ? <LegCountWarning direction="arrival" count={arrivalLegCount} /> : null}
      {departureLegCount > 1 ? (
        <LegCountWarning direction="departure" count={departureLegCount} />
      ) : null}

      {/* Band (a) — what the record held before this call. */}
      <BeforeBand group={existingGroup} arrival={existingArrival} departure={existingDeparture} />

      {/* Band (b) — what we heard, editable. */}
      <Card>
        <CardHeader>
          <CardTitle>
            <p className="font-semibold text-fg">What we heard</p>
            <p className="text-xs text-muted">
              Edit anything that is wrong. What you save is what gets written.
            </p>
          </CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          <ReviewField {...fieldProps('rsvpStatus')} format={formatRsvp}>
            <Select
              label={<FieldLabel state={fieldStates.rsvpStatus}>RSVP status</FieldLabel>}
              value={values.rsvpStatus}
              onChange={(e) => update('rsvpStatus', e.target.value)}
              disabled={alreadyApplied}
              placeholder="Not set"
              options={RSVP_STATUS_OPTIONS.map((v) => ({ value: v, label: RSVP_STATUS_LABELS[v] }))}
            />
          </ReviewField>

          <ReviewField {...fieldProps('confirmedPax')}>
            <Input
              label={<FieldLabel state={fieldStates.confirmedPax}>Confirmed pax</FieldLabel>}
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={values.confirmedPax}
              onChange={(e) => update('confirmedPax', e.target.value)}
              disabled={alreadyApplied}
              error={missingPax ? 'How many people are coming?' : null}
            />
          </ReviewField>

          <ReviewField {...fieldProps('side')} format={formatSide}>
            <Select
              label={<FieldLabel state={fieldStates.side}>Side</FieldLabel>}
              hint="Not captured by the AI — set this yourself if you know it."
              value={values.side}
              onChange={(e) => update('side', e.target.value)}
              disabled={alreadyApplied}
              placeholder="Not set"
              options={SIDE_OPTIONS.map((v) => ({ value: v, label: SIDE_LABELS[v] }))}
            />
          </ReviewField>

          <ReviewField {...fieldProps('remarks')}>
            <Textarea
              label={<FieldLabel state={fieldStates.remarks}>Remarks</FieldLabel>}
              hint="Mapped from the AI's special_requests field onto guest_groups.remarks."
              value={values.remarks}
              onChange={(e) => update('remarks', e.target.value)}
              disabled={alreadyApplied}
              rows={3}
            />
          </ReviewField>
        </CardBody>
      </Card>

      <LegCard
        title="Arrival"
        direction="arrival"
        values={values.arrival}
        fieldProps={fieldProps}
        fieldStates={fieldStates}
        disabled={alreadyApplied}
        onChange={update}
      />

      <LegCard
        title="Departure"
        direction="departure"
        values={values.departure}
        fieldProps={fieldProps}
        fieldStates={fieldStates}
        disabled={alreadyApplied}
        onChange={update}
      />

      {/* Band (c) — the evidence, one tap away. */}
      <TranscriptPanel transcript={transcript} />

      {!alreadyApplied && (unresolved.length > 0 || missingPax) ? (
        <Card className="border-danger/40 bg-tint-danger">
          <CardBody className="flex flex-col gap-1 py-3 text-sm text-danger">
            <p className="font-semibold">Saving is blocked until these are decided.</p>
            {missingPax ? (
              <p>
                <span className="font-medium">How many people are coming?</span> A confirmed family
                with no head count breaks room allocation later.
              </p>
            ) : null}
            {unresolved.length > 0 ? (
              <p>
                Not heard clearly, still undecided:{' '}
                <span className="font-medium">{unresolved.map((f) => f.label).join(', ')}</span>.
                Type what they said, or tick &ldquo;not heard&rdquo; on each.
              </p>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {clearAttempts.length > 0 ? (
        <Card className="border-danger/40 bg-tint-danger">
          <CardBody className="py-3 text-sm text-danger">
            <p className="font-semibold">
              {clearAttempts.length} field{clearAttempts.length === 1 ? '' : 's'} can&apos;t be
              cleared this way.
            </p>
            <p className="mt-0.5">
              The save keeps the existing value whenever a field is left blank — there is no way to
              null a field out through this screen. Either type a replacement value, or restore what
              was there before, for each field flagged above.
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
          <Textarea
            label="Reason for discarding"
            hint="Only used if you discard. Ignored when you save."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={alreadyApplied}
            rows={2}
          />

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
              disabled={blocked || isBusy}
            >
              Confirm and save
            </Button>
            <Button
              size="lg"
              variant="danger"
              fullWidth
              onClick={handleDiscard}
              loading={pendingAction === 'discard'}
              disabled={alreadyApplied || isBusy}
            >
              Discard and enter manually
            </Button>
          </div>

          {invalidNumbers.length > 0 ? (
            <p className="text-xs text-subtle">
              Saving is disabled while a pax field is not a whole number:{' '}
              {invalidNumbers.map((n) => n.label).join(', ')}.
            </p>
          ) : null}
        </CardBody>
      </Card>
    </div>
  )
}

function LegCountWarning({
  direction,
  count,
}: {
  direction: 'arrival' | 'departure'
  count: number
}) {
  return (
    <Card className="border-warning/40 bg-tint-warning">
      <CardBody className="py-3 text-sm text-warning">
        <p className="font-semibold">
          {count} {direction} legs on file.
        </p>
        <p className="mt-0.5">
          Saving only ever edits the oldest {direction} leg (first one added). Any later{' '}
          {direction} leg for this group will not change here — edit it directly if it needs fixing.
        </p>
      </CardBody>
    </Card>
  )
}

function LegCard({
  title,
  direction,
  values,
  fieldStates,
  fieldProps,
  disabled,
  onChange,
}: {
  title: string
  direction: 'arrival' | 'departure'
  values: { mode: string; date: string; time: string; reference: string; point: string; pax: string }
  fieldStates: FieldStates
  fieldProps: (key: FieldKey) => Omit<Parameters<typeof ReviewField>[0], 'children' | 'format'>
  disabled: boolean
  onChange: (key: FieldKey, value: string) => void
}) {
  const key = (field: string) => `${direction}.${field}` as FieldKey

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <p className="font-semibold text-fg">{title}</p>
        </CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        <ReviewField {...fieldProps(key('mode'))} format={formatMode}>
          <Select
            label={<FieldLabel state={fieldStates[key('mode')]}>Mode</FieldLabel>}
            value={values.mode}
            onChange={(e) => onChange(key('mode'), e.target.value)}
            disabled={disabled}
            placeholder="Not set"
            options={TRAVEL_MODE_OPTIONS.map((v) => ({ value: v, label: TRAVEL_MODE_LABELS[v] }))}
          />
        </ReviewField>

        <ReviewField {...fieldProps(key('date'))} format={formatDay}>
          <Input
            label={<FieldLabel state={fieldStates[key('date')]}>Date</FieldLabel>}
            type="date"
            value={values.date}
            onChange={(e) => onChange(key('date'), e.target.value)}
            disabled={disabled}
          />
        </ReviewField>

        <ReviewField {...fieldProps(key('time'))}>
          <Input
            label={<FieldLabel state={fieldStates[key('time')]}>Time</FieldLabel>}
            type="time"
            value={values.time}
            onChange={(e) => onChange(key('time'), e.target.value)}
            disabled={disabled}
          />
        </ReviewField>

        <ReviewField {...fieldProps(key('reference'))}>
          <Input
            label={<FieldLabel state={fieldStates[key('reference')]}>Reference</FieldLabel>}
            hint="Flight / train number, PNR — whatever was actually said."
            value={values.reference}
            onChange={(e) => onChange(key('reference'), e.target.value)}
            disabled={disabled}
          />
        </ReviewField>

        <ReviewField {...fieldProps(key('point'))}>
          <Input
            label={<FieldLabel state={fieldStates[key('point')]}>Point</FieldLabel>}
            hint="Airport, station, or pickup/drop location."
            value={values.point}
            onChange={(e) => onChange(key('point'), e.target.value)}
            disabled={disabled}
          />
        </ReviewField>

        <ReviewField {...fieldProps(key('pax'))}>
          <Input
            label={<FieldLabel state={fieldStates[key('pax')]}>Pax on this leg</FieldLabel>}
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={values.pax}
            onChange={(e) => onChange(key('pax'), e.target.value)}
            disabled={disabled}
          />
        </ReviewField>
      </CardBody>
    </Card>
  )
}

export default ReviewForm
