'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import { CheckCircleIcon, InboxIcon, MinusIcon, PlusIcon } from '@/components/icons'
import { saveRsvpLog } from '@/lib/actions/rsvp'
import { cn, formatDateTime } from '@/lib/utils'
import { rsvpStatusLabel, rsvpStatusTone } from '@/lib/rsvp'
import { formatMobile } from '@/lib/phone'
import { outcomeOption, type CallAttemptRow, type GuestGroupRow } from '@/lib/call/types'
import {
  CONFIRMING_STATUSES,
  RSVP_LOG_STATUS_OPTIONS,
  SPECIAL_REQUIREMENTS_OPTIONS,
  TERMINAL_STATUSES,
  rsvpLogSchema,
  toDisplayCount,
  type LegFormValues,
  type RsvpLogFormValues,
  type SpecialRequirement,
} from '@/lib/rsvp-log'

const STATUS_LABELS: Record<string, string> = {
  confirmed: 'Coming',
  declined: 'Not coming',
  tentative: 'Maybe',
  callback: 'Call back',
  unreachable: 'No answer',
}

const STATUS_HINTS: Record<string, string> = {
  confirmed: 'Confirmed',
  declined: 'Declined',
  tentative: 'Not sure yet',
  callback: 'Asked us to call later',
  unreachable: 'Could not reach',
}

const DRAFT_KEY = 'eventflow:rsvp-draft'

/**
 * A saved draft, ready to be rehydrated. `attemptId` is the one
 * call_attempts row this entry belongs to — the row freezes the moment the
 * outcome is written, so a draft can only ever attach to one attempt. When
 * no attempt is in flight the group still gets an entry, but it carries no
 * attempt id (see saveRsvpLog's `attempt_id` param).
 */
export interface RsvpDraft {
  groupId: string
  attemptId: string | null
  values: RsvpLogFormValues
  savedAt: number
}

function readDraft(groupId: string): RsvpDraft | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as RsvpDraft
    if (parsed.groupId !== groupId || !parsed.values) return null
    return parsed
  } catch {
    return null
  }
}

export interface RsvpLogFormProps {
  eventId: string
  eventCode: string
  viewerId: string
  group: GuestGroupRow
  attempts: CallAttemptRow[]
  initialValues: RsvpLogFormValues
  /** The call_attempts row this entry belongs to, if one is in flight. */
  inFlightAttempt: CallAttemptRow | null
  /** Whether to navigate to the next queue family after a successful save. */
  hasQueueNext: boolean
}

export function RsvpLogForm({
  eventId,
  eventCode,
  viewerId,
  group,
  attempts,
  initialValues,
  inFlightAttempt,
  hasQueueNext,
}: RsvpLogFormProps) {
  const router = useRouter()

  // The draft rehydrates ONCE on mount (before the first paint of the form),
  // then is discarded. A fresh page load must never fight over the entry.
  const [values, setValues] = useState<RsvpLogFormValues>(() => {
    const draft = readDraft(group.id)
    return draft?.values ?? initialValues
  })

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Validate the live form values against the schema on every change, and
  // map any issue onto its field path for inline rendering. Used by both the
  // field-level errors and the top-level save validation.
  const { fieldErrors } = useMemo(() => {
    const parsed = rsvpLogSchema.safeParse(values)
    if (!parsed.success) {
      const map: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.')
        if (!(key in map)) map[key] = issue.message
      }
      return { fieldErrors: map }
    }
    return { fieldErrors: {} }
  }, [values])

  // Autosave: sessionStorage on every change. "A mis-tap or an incoming
  // call doesn't lose the entry" — this is local device state, never the
  // server. It survives a page refresh (sessionStorage) but not a fresh
  // session; a durable per-group draft is deliberately not attempted here.
  // Rehydration happens once in the lazy initializer above; this effect
  // only ever writes the CURRENT values back after a change.
  useEffect(() => {
    try {
      const draft: RsvpDraft = {
        groupId: group.id,
        attemptId: inFlightAttempt?.id ?? null,
        values,
        savedAt: Date.now(),
      }
      window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
    } catch {
      // Storage full or private browsing — the form still works, just no draft.
    }
  }, [values, group.id, inFlightAttempt])

  const status = values.rsvpStatus
  const statusError = fieldErrors['rsvpStatus']
  // The schema's statuses are the only values the form can hold; a blank is
  // the pre-choice state, not a status, so both checks guard on it first.
  const confirming =
    status !== '' && CONFIRMING_STATUSES.has(status as Exclude<RsvpLogFormValues['rsvpStatus'], ''>)
  const collapsed =
    status !== '' && TERMINAL_STATUSES.has(status as Exclude<RsvpLogFormValues['rsvpStatus'], ''>)
  const showCallback = status === 'callback'

  const attemptsCount = attempts.length
  const hasEarlierAttempts = attempts.some((a) => a.id !== inFlightAttempt?.id)

  // The save handler validates through the same Zod schema the UI renders
  // errors for, then sends to the RPC.
  async function handleSave() {
    if (saving || saved) return
    setError(null)

    const parsed = rsvpLogSchema.safeParse(values)
    if (!parsed.success) {
      const first = parsed.error.issues[0]
      setError(first?.message ?? 'The form has a problem.')
      return
    }

    setSaving(true)
    const result = await saveRsvpLog({
      eventId,
      eventCode,
      groupId: group.id,
      values: parsed.data,
    })
    setSaving(false)

    if (!result.ok) {
      setError(result.message)
      return
    }

    // The entry is written and the lock released. Drop the draft so the next
    // visit starts clean.
    try {
      window.sessionStorage.removeItem(DRAFT_KEY)
    } catch {
      // Nothing to do.
    }
    setSaved(true)

    if (hasQueueNext) {
      router.push(`/${eventCode}/rsvp/next`)
      return
    }
    router.push(`/${eventCode}/rsvp/status`)
  }

  function updateField<K extends keyof RsvpLogFormValues>(key: K, value: RsvpLogFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  function updateLeg(direction: 'arrival' | 'departure', field: keyof LegFormValues, value: string) {
    setValues((prev) => ({
      ...prev,
      [direction]: { ...prev[direction], [field]: value },
    }))
  }

  function toggleRequirement(req: SpecialRequirement) {
    const current = values.specialRequirements
    const has = current.includes(req)
    updateField(
      'specialRequirements',
      has ? current.filter((r) => r !== req) : [...current, req],
    )
  }

  if (saved) {
    return <SavedState hasQueueNext={hasQueueNext} />
  }

  return (
    <div className="flex flex-col gap-4">
      {hasEarlierAttempts ? (
        <PreviousAttempts
          attempts={attempts}
          viewerId={viewerId}
          inFlightAttemptId={inFlightAttempt?.id ?? null}
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-lg font-semibold text-fg">{group.head_name}</h2>
            <p className="text-sm text-muted">
              {group.group_type} · {formatMobile(group.primary_mobile)}
              {attemptsCount > 0 ? ` · ${attemptsCount} call${attemptsCount === 1 ? '' : 's'} so far` : ''}
            </p>
          </CardTitle>
          <Badge tone={rsvpStatusTone(group.rsvp_status)} size="md">
            {rsvpStatusLabel(group.rsvp_status)}
          </Badge>
        </CardHeader>
        <CardBody className="flex flex-col gap-4">
          <StatusSelect
            value={status}
            error={statusError}
            onChange={(value) => updateField('rsvpStatus', value as RsvpLogFormValues['rsvpStatus'])}
          />

          {confirming ? (
            <div className="grid grid-cols-2 gap-3">
              <Stepper
                label="Adults"
                value={values.adultsConfirmed}
                onChange={(v) => updateField('adultsConfirmed', v)}
              />
              <Stepper
                label="Children"
                value={values.childrenConfirmed}
                onChange={(v) => updateField('childrenConfirmed', v)}
              />
            </div>
          ) : null}

          {status === 'tentative' ? (
            <p className="text-sm text-muted">How many people are tentatively coming?</p>
          ) : null}
        </CardBody>
      </Card>

      {collapsed ? (
        <CollapsedNote status={status} />
      ) : (
        <>
          {status === 'confirmed' ? (
            <ConfirmedCard
              values={values}
              fieldErrors={fieldErrors}
              updateField={updateField}
              updateLeg={updateLeg}
              toggleRequirement={toggleRequirement}
            />
          ) : null}

          {showCallback ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2 className="text-base font-semibold text-fg">Call back</h2>
                  <p className="text-sm text-muted">
                    When should someone call this family again?
                  </p>
                </CardTitle>
              </CardHeader>
              <CardBody>
                <Input
                  type="datetime-local"
                  label="Call back at"
                  required
                  min={toDatetimeLocalValue(new Date())}
                  value={values.callbackDatetime}
                  onChange={(e) => updateField('callbackDatetime', e.target.value)}
                  aria-invalid={fieldErrors['callbackDatetime'] ? true : undefined}
                />
                {fieldErrors['callbackDatetime'] ? (
                  <p className="mt-1 text-sm font-medium text-danger">
                    {fieldErrors['callbackDatetime']}
                  </p>
                ) : null}
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>
                <h2 className="text-base font-semibold text-fg">Anything else</h2>
              </CardTitle>
            </CardHeader>
            <CardBody className="flex flex-col gap-4">
              <Textarea
                label="Notes"
                hint="Anything useful for next time — who you spoke to, what they said."
                value={values.notes}
                onChange={(e) => updateField('notes', e.target.value)}
                rows={3}
              />
            </CardBody>
          </Card>
        </>
      )}

      {error ? (
        <p role="alert" className="rounded-xl border border-danger bg-tint-danger px-4 py-3 text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}

      <Button
        size="lg"
        fullWidth
        loading={saving}
        disabled={status === ''}
        onClick={handleSave}
      >
        Save outcome
      </Button>
    </div>
  )
}

/** Native datetime-local wants local "YYYY-MM-DDTHH:MM", never UTC. */
function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

function StatusSelect({
  value,
  error,
  onChange,
}: {
  value: string
  error?: string
  onChange: (value: string) => void
}) {
  return (
    <div>
      <p className="text-sm font-medium text-fg">
        How did the call go?
        <span className="ml-0.5 text-danger" aria-hidden>
          *
        </span>
      </p>
      <div
        className="mt-2 grid grid-cols-2 gap-2"
        role="radiogroup"
        aria-label="How did the call go"
        aria-required="true"
      >
        {RSVP_LOG_STATUS_OPTIONS.map((option) => {
          const selected = value === option
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option)}
              className={cn(
                'tap flex min-h-14 flex-col items-start justify-center gap-0.5 rounded-xl border px-3 py-2 text-left transition-colors',
                selected
                  ? 'border-brand bg-brand text-brand-fg'
                  : 'border-border-strong bg-surface text-fg hover:bg-surface-2 active:bg-surface-2',
              )}
            >
              <span className="text-sm font-semibold">{STATUS_LABELS[option]}</span>
              <span className={cn('text-xs', selected ? 'text-brand-fg/80' : 'text-muted')}>
                {STATUS_HINTS[option]}
              </span>
            </button>
          )
        })}
      </div>
      {error ? <p className="mt-1 text-sm font-medium text-danger">{error}</p> : null}
    </div>
  )
}

function Stepper({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  const count = toDisplayCount(value)
  return (
    <div>
      <p className="text-sm font-medium text-fg">{label}</p>
      <div className="mt-1.5 flex items-center gap-2">
        <button
          type="button"
          aria-label={`Fewer ${label.toLowerCase()}`}
          onClick={() => onChange(count > 0 ? String(count - 1) : '')}
          className="tap flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border-strong bg-surface text-fg hover:bg-surface-2 active:bg-surface-2 active:opacity-80"
        >
          <MinusIcon className="h-5 w-5" />
        </button>
        <span className="w-10 text-center font-mono text-xl tabular-nums text-fg">{count}</span>
        <button
          type="button"
          aria-label={`More ${label.toLowerCase()}`}
          onClick={() => onChange(String(count + 1))}
          className="tap flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-border-strong bg-surface text-fg hover:bg-surface-2 active:bg-surface-2 active:opacity-80"
        >
          <PlusIcon className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}

function ConfirmedCard({
  values,
  fieldErrors,
  updateField,
  updateLeg,
  toggleRequirement,
}: {
  values: RsvpLogFormValues
  fieldErrors: Record<string, string>
  updateField: <K extends keyof RsvpLogFormValues>(key: K, value: RsvpLogFormValues[K]) => void
  updateLeg: (direction: 'arrival' | 'departure', field: keyof LegFormValues, value: string) => void
  toggleRequirement: (req: SpecialRequirement) => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold text-fg">Travel &amp; details</h2>
          <p className="text-sm text-muted">All optional — skip what you did not ask.</p>
        </CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        <TravelLegSection
          direction="arrival"
          title="Arrival"
          values={values.arrival}
          fieldErrors={fieldErrors}
          onChange={(field, value) => updateLeg('arrival', field, value)}
        />

        <TravelLegSection
          direction="departure"
          title="Departure"
          values={values.departure}
          fieldErrors={fieldErrors}
          onChange={(field, value) => updateLeg('departure', field, value)}
        />

        <PickupToggle
          checked={values.needsPickup}
          onChange={(checked) => updateField('needsPickup', checked)}
        />

        <div>
          <p className="text-sm font-medium text-fg">Special requirements</p>
          <p className="mt-0.5 text-sm text-muted">Tick anything they asked for.</p>
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Special requirements">
            {SPECIAL_REQUIREMENTS_OPTIONS.map((option) => {
              const active = values.specialRequirements.includes(option.value)
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleRequirement(option.value)}
                  className={cn(
                    'tap min-h-12 shrink-0 rounded-full border px-4 text-sm font-semibold transition-colors active:opacity-80',
                    active
                      ? 'border-transparent bg-brand text-brand-fg'
                      : 'border-rule-strong bg-surface text-ink hover:bg-surface-2 active:bg-surface-2',
                  )}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        </div>
      </CardBody>
    </Card>
  )
}

function TravelLegSection({
  direction,
  title,
  values,
  fieldErrors,
  onChange,
}: {
  direction: 'arrival' | 'departure'
  title: string
  values: LegFormValues
  fieldErrors: Record<string, string>
  onChange: (field: keyof LegFormValues, value: string) => void
}) {
  const dateKey = `${direction}.date`
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-semibold text-fg">{title}</p>
      <Select
        label="Mode"
        value={values.mode}
        onChange={(e) => onChange('mode', e.target.value)}
        placeholder="Not asked"
        options={[
          { value: 'air', label: 'Air' },
          { value: 'train', label: 'Train' },
          { value: 'bus', label: 'Bus' },
          { value: 'cab', label: 'Cab' },
          { value: 'self_drive', label: 'Self-drive' },
        ]}
      />
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Date"
          type="date"
          value={values.date}
          onChange={(e) => onChange('date', e.target.value)}
          aria-invalid={fieldErrors[dateKey] ? true : undefined}
        />
        <Input
          label="Time"
          type="time"
          value={values.time}
          onChange={(e) => onChange('time', e.target.value)}
        />
      </div>
      {fieldErrors[dateKey] ? (
        <p className="text-sm font-medium text-danger">{fieldErrors[dateKey]}</p>
      ) : null}
      <Input
        label={direction === 'arrival' ? 'Location' : 'Drop location'}
        hint="Airport, station, or stop."
        value={values.location}
        onChange={(e) => onChange('location', e.target.value)}
      />
      <Input
        label={direction === 'arrival' ? 'Flight / train no.' : 'Return flight / train no.'}
        value={values.flightTrainNo}
        onChange={(e) => onChange('flightTrainNo', e.target.value)}
      />
    </div>
  )
}

function PickupToggle({
  checked,
  onChange,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="tap flex min-h-12 items-center justify-between gap-3 rounded-xl border border-border-strong bg-surface px-3.5 text-left"
    >
      <span>
        <span className="block text-sm font-medium text-fg">Needs pickup</span>
        <span className="block text-xs text-muted">Arranged a car from the airport or station</span>
      </span>
      <span
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors',
          checked ? 'bg-brand' : 'bg-surface-3',
        )}
        aria-hidden
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
            checked && 'translate-x-5',
          )}
        />
      </span>
    </button>
  )
}

function CollapsedNote({ status }: { status: string }) {
  const label = STATUS_LABELS[status] ?? status
  return (
    <Card className="border-border-strong bg-surface-2">
      <CardBody className="py-3 text-sm text-muted">
        <p className="font-semibold text-fg">
          {status === 'declined' ? 'Declined' : 'Could not reach'} — nothing else to fill in.
        </p>
        <p className="mt-0.5">
          Marked as <span className="font-medium text-fg">{label}</span>. Add a note above if you
          want to record what was said.
        </p>
      </CardBody>
    </Card>
  )
}

function PreviousAttempts({
  attempts,
  viewerId,
  inFlightAttemptId,
}: {
  attempts: CallAttemptRow[]
  viewerId: string
  inFlightAttemptId: string | null
}) {
  const past = attempts.filter((a) => a.id !== inFlightAttemptId)
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold text-fg">
            Previous calls ({past.length})
          </h2>
        </CardTitle>
      </CardHeader>
      <CardBody>
        {past.length === 0 ? (
          <EmptyState
            icon={<InboxIcon className="h-6 w-6" />}
            title="No earlier calls"
            description="This will be the first time this family has been called."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {past.map((attempt) => (
              <li key={attempt.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-fg">
                    {formatDateTime(attempt.started_at)}
                  </span>
                  {attempt.outcome ? (
                    <Badge tone={outcomeOption(attempt.outcome)?.tone ?? 'neutral'}>
                      {outcomeOption(attempt.outcome)?.label ?? attempt.outcome}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">No outcome recorded</Badge>
                  )}
                </div>
                <p className="text-xs text-muted">
                  {attempt.caller_id === viewerId || attempt.caller_id_staff === viewerId
                    ? 'You'
                    : 'Another caller'} · dialed{' '}
                  {formatMobile(attempt.dialed_number)}
                </p>
                {attempt.notes ? <p className="text-sm text-fg">{attempt.notes}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}

function SavedState({ hasQueueNext }: { hasQueueNext: boolean }) {
  return (
    <Card>
      <CardBody className="flex flex-col items-center gap-2 py-8 text-center">
        <CheckCircleIcon className="h-10 w-10 text-success" />
        <p className="text-lg font-semibold text-fg">Saved</p>
        <p className="max-w-xs text-sm text-muted">
          {hasQueueNext
            ? "This family's RSVP is recorded. Moving to the next one…"
            : "This family's RSVP is recorded."}
        </p>
      </CardBody>
    </Card>
  )
}

export default RsvpLogForm
