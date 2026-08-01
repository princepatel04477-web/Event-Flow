'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import { applyManualEntry } from '@/lib/actions/review'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
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
  setFormValue,
  type FieldKey,
  type InvalidNumber,
  type ExistingGroupValues,
  type ExistingLegValues,
  type LegFormValues,
  type ReviewFormValues,
} from '@/lib/review/payload'

export interface ManualFormProps {
  eventCode: string
  eventId: string
  groupId: string
  headName: string
  cameFromReview: boolean
  initialValues: ReviewFormValues
  existingGroup: ExistingGroupValues
  existingArrival: ExistingLegValues | null
  existingDeparture: ExistingLegValues | null
}

/**
 * Typing the RSVP by hand.
 *
 * Reached when a caller discards an extraction ("that is not what they
 * said"), or when there is no recording to extract from at all. Deliberately
 * the same field set and the same guards as the review screen — the only
 * things missing are the confidence colouring and the transcript, because
 * there is no model output to judge.
 */
export function ManualForm({
  eventCode,
  eventId,
  groupId,
  headName,
  cameFromReview,
  initialValues,
  existingGroup,
  existingArrival,
  existingDeparture,
}: ManualFormProps) {
  const router = useRouter()

  const [values, setValues] = useState<ReviewFormValues>(initialValues)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clearAttempts = useMemo(
    () => detectClearAttempts(values, existingGroup, existingArrival, existingDeparture),
    [values, existingGroup, existingArrival, existingDeparture],
  )
  const invalidNumbers = useMemo(() => detectInvalidNumbers(values), [values])
  const invalidByField = useMemo(
    () => new Map(invalidNumbers.map((n) => [n.field, n])),
    [invalidNumbers],
  )
  const missingPax = useMemo(() => detectMissingConfirmedPax(values), [values])

  const blocked = clearAttempts.length > 0 || invalidNumbers.length > 0 || missingPax

  function update(key: FieldKey, value: string) {
    setValues((prev) => setFormValue(prev, key, value))
  }

  async function handleSave() {
    if (blocked) return
    setError(null)
    setSaving(true)

    const result = await applyManualEntry(eventCode, eventId, groupId, buildRpcPayload(values))

    if (!result.ok) {
      setError(result.error)
      setSaving(false)
      return
    }

    router.push(`/${eventCode}/queue?done=applied`)
  }

  return (
    <div className="flex flex-col gap-4 pb-4">
      <Card>
        <CardBody className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold text-fg">{headName}</h1>
          <p className="text-sm text-muted">
            {cameFromReview
              ? 'The AI draft was discarded. Type what the family actually said.'
              : 'Type the RSVP as it was given on the call.'}
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <p className="font-semibold text-fg">RSVP</p>
          </CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          <Select
            label="RSVP status"
            value={values.rsvpStatus}
            onChange={(e) => update('rsvpStatus', e.target.value)}
            placeholder="Not set"
            options={RSVP_STATUS_OPTIONS.map((v) => ({ value: v, label: RSVP_STATUS_LABELS[v] }))}
          />

          <div>
            <Input
              label="Confirmed pax"
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={values.confirmedPax}
              onChange={(e) => update('confirmedPax', e.target.value)}
              error={missingPax ? 'How many people are coming?' : null}
            />
            <InvalidNumberNote invalid={invalidByField.get('confirmedPax')} />
          </div>

          <Select
            label="Side"
            value={values.side}
            onChange={(e) => update('side', e.target.value)}
            placeholder="Not set"
            options={SIDE_OPTIONS.map((v) => ({ value: v, label: SIDE_LABELS[v] }))}
          />

          <Textarea
            label="Remarks"
            hint="Special requests, wheelchair needs, anything worth remembering."
            value={values.remarks}
            onChange={(e) => update('remarks', e.target.value)}
            rows={3}
          />
        </CardBody>
      </Card>

      <ManualLegCard
        title="Arrival"
        direction="arrival"
        values={values.arrival}
        invalidByField={invalidByField}
        onChange={update}
      />
      <ManualLegCard
        title="Departure"
        direction="departure"
        values={values.departure}
        invalidByField={invalidByField}
        onChange={update}
      />

      {clearAttempts.length > 0 ? (
        <Card className="border-danger/40 bg-tint-danger">
          <CardBody className="py-3 text-sm text-danger">
            <p className="font-semibold">
              {clearAttempts.length} field{clearAttempts.length === 1 ? '' : 's'} can&apos;t be
              cleared this way.
            </p>
            <p className="mt-0.5">
              Blanking a field keeps whatever the record already holds — there is no way to null one
              out from here. Type a replacement, or restore what was there:{' '}
              {clearAttempts.map((a) => a.label).join(', ')}.
            </p>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardBody className="flex flex-col gap-3">
          {error ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          ) : null}
          <Button size="lg" fullWidth onClick={handleSave} loading={saving} disabled={blocked}>
            Save RSVP
          </Button>
          <p className="text-xs text-subtle">
            Saves the group and its travel legs together, and releases your lock on this family.
          </p>
        </CardBody>
      </Card>
    </div>
  )
}

function InvalidNumberNote({ invalid }: { invalid: InvalidNumber | undefined }) {
  if (!invalid) return null
  return (
    <p className="mt-1 text-xs font-medium text-danger">
      &ldquo;{invalid.raw}&rdquo; is not a whole number of people.
    </p>
  )
}

function ManualLegCard({
  title,
  direction,
  values,
  invalidByField,
  onChange,
}: {
  title: string
  direction: 'arrival' | 'departure'
  values: LegFormValues
  invalidByField: Map<string, InvalidNumber>
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
        <Select
          label="Mode"
          value={values.mode}
          onChange={(e) => onChange(key('mode'), e.target.value)}
          placeholder="Not set"
          options={TRAVEL_MODE_OPTIONS.map((v) => ({ value: v, label: TRAVEL_MODE_LABELS[v] }))}
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Date"
            type="date"
            value={values.date}
            onChange={(e) => onChange(key('date'), e.target.value)}
          />
          <Input
            label="Time"
            type="time"
            value={values.time}
            onChange={(e) => onChange(key('time'), e.target.value)}
          />
        </div>

        <Input
          label="Reference"
          hint="Flight / train number, PNR."
          value={values.reference}
          onChange={(e) => onChange(key('reference'), e.target.value)}
        />

        <Input
          label="Point"
          hint="Airport, station, or pickup/drop location."
          value={values.point}
          onChange={(e) => onChange(key('point'), e.target.value)}
        />

        <div>
          <Input
            label="Pax on this leg"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={values.pax}
            onChange={(e) => onChange(key('pax'), e.target.value)}
          />
          <InvalidNumberNote invalid={invalidByField.get(key('pax'))} />
        </div>
      </CardBody>
    </Card>
  )
}

export default ManualForm
