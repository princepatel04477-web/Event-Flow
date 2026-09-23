'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import { BottomBar } from '@/components/ui/BottomBar'
import { Chip } from '@/components/ui/Chip'
import { Input } from '@/components/ui/Input'
import { Row } from '@/components/ui/Row'
import { Select } from '@/components/ui/Select'
import { Stepper } from '@/components/ui/Stepper'
import { Textarea } from '@/components/ui/Textarea'
import { CheckCircleIcon, ChevronDownIcon, ChevronRightIcon } from '@/components/icons'
import { saveRsvpLog } from '@/lib/actions/rsvp'
import { releaseGroupAfterCall } from '@/lib/actions/call'
import { cn, formatDateTime } from '@/lib/utils'
import { rsvpStatusLabel } from '@/lib/rsvp'
import { formatMobile } from '@/lib/phone'
import { outcomeOption, type CallAttemptRow, type GuestGroupRow } from '@/lib/call/types'
import { initials } from '@/lib/ui/metrics'
import { statusTone, type RsvpStatus } from '@/lib/status'
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

/**
 * The five outcomes a caller can record, in the order they are offered.
 *
 * The v3 form uses the caller's own words, not the enum's: "Coming", not
 * "Confirmed". The second-line hints are gone — five one-word chips say the
 * same thing as five two-line cards in a fifth of the height, and none of the
 * words needed the hint to be unambiguous.
 *
 * ORDER IS THE CALLER'S, MEMBERSHIP IS THE SCHEMA'S. The presentation order
 * below is filtered against `RSVP_LOG_STATUS_OPTIONS` (the list the save
 * schema accepts), so a status added or removed there can never render a chip
 * the save would reject — and a status missing from `OUTCOME_LABELS` falls
 * back to its own enum word rather than vanishing.
 */
const OUTCOME_LABELS: Record<string, string> = {
  confirmed: 'Coming',
  declined: 'Not coming',
  unreachable: 'No answer',
  callback: 'Call back',
  tentative: 'Maybe',
}

const OUTCOME_ORDER: RsvpStatus[] = [
  'confirmed',
  'declined',
  'unreachable',
  'callback',
  'tentative',
]

const OUTCOMES: { value: RsvpStatus; label: string }[] = OUTCOME_ORDER.filter((s) =>
  RSVP_LOG_STATUS_OPTIONS.includes(s),
).map((value) => ({ value, label: OUTCOME_LABELS[value] ?? value }))

/** The status word for the summary line, in the caller's words not the enum's. */
function outcomeWord(status: string): string {
  return OUTCOMES.find((o) => o.value === status)?.label ?? rsvpStatusLabel(status)
}

/** Row tone for an outcome, so the chip's dot and the row agree. */
function outcomeRowTone(status: string): 'neutral' | 'done' | 'waiting' | 'problem' {
  const tone = statusTone(status)
  if (tone === 'done') return 'done'
  if (tone === 'attention') return 'problem'
  if (tone === 'active') return 'waiting'
  return 'neutral'
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
  const previousAttempts = attempts.filter((a) => a.id !== inFlightAttempt?.id)
  const hasEarlierAttempts = previousAttempts.length > 0

  const guestCount =
    toDisplayCount(values.adultsConfirmed) + toDisplayCount(values.childrenConfirmed)

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

    // Release the caller lock the RSVP status screen claimed on open. The
    // `save_rsvp_log` RPC already clears it in the same transaction as the
    // outcome; this is the belt to that braces.
    //
    // Guard on holding the lock rather than delegating the decision to
    // release_group. Migration 20260813000000 removed that function's
    // `or app.is_admin()` branch — which used to let any admin clear
    // whichever caller held the lock — so the RPC is now safe on its own.
    // The guard stays because it is the call site's job to know whether it
    // holds a lock, and because it keeps this screen correct if the RPC's
    // semantics ever drift again. See tests/l4_lock_release.sql.
    const holdsLock =
      group.locked_by === viewerId ||
      (group.locked_by_staff !== null && group.locked_by_staff === viewerId)
    // THE SCREEN RESPONDS ON THE FIRST HOP; the second one only delays the
    // navigation, and it has to be awaited. Two findings decide that, and the
    // first is why an earlier version of this change was wrong.
    //
    // 1. THE RELEASE CANNOT BE UN AWAITED. `release_group` matches on caller
    //    IDENTITY and not on any claim generation (20260813000000:66-69), so an
    //    in-flight release racing a LATER claim by the same caller wipes that
    //    caller's own fresh lock. It is reachable: an outcome logged without
    //    dialling writes no `call_attempts` row, so the family stays at
    //    attempt_count = 0, and `/rsvp/next` sorts that column ascending — it can
    //    send the caller straight back to the family they just saved, whose page
    //    then re-claims it. The migration header for 20260813000000 names this
    //    exact hazard and says ordering at the call site is the only fix, which
    //    is why this is sequenced before `router.push` rather than fired off.
    //
    // 2. THE RELEASE IS STILL NECESSARY, and still only by the holder. The lock's
    //    BLOCKING effect ended when the outcome committed — `save_rsvp_log` nulls
    //    `locked_until` in the same transaction (20260807000502:194-195) and
    //    claim_group / v_rsvp_queue.is_locked both require it to be non-null and
    //    in the future — but `save_rsvp_log` never touches `locked_by_staff`,
    //    because it predates that column (added in 20260808100000). What the
    //    release clears is that residue: a dangling `ON DELETE RESTRICT` reference
    //    to staff_members. Cleanup, but real cleanup, and deleting this call would
    //    leave one behind on every family a team session logs.
    //
    // So the win here is ORDERING, not elimination: `setSaved(true)` now happens
    // immediately after the save, so the runner sees the outcome after one round
    // trip instead of two. Only the navigation waits for the lock cleanup.
    try {
      window.sessionStorage.removeItem(DRAFT_KEY)
    } catch {
      // Nothing to do.
    }
    setSaved(true)

    if (holdsLock) {
      const release = await releaseGroupAfterCall(eventId, group.id, eventCode)
      if (!release.ok) {
        // The outcome IS saved. Say what actually failed rather than implying the
        // RSVP did not land — and do not navigate away from an unreleased lock of
        // ours, because the next claim of this family could then be wiped by it.
        setError(
          release.message ??
            'Saved, but the caller lock could not be released. Try again in a moment.',
        )
        return
      }
    }

    // The screen moves once the lock is genuinely clear.
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

  const metaLine = [
    group.group_type,
    formatMobile(group.primary_mobile),
    attemptsCount > 0 ? `${attemptsCount} ${attemptsCount === 1 ? 'call' : 'calls'}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const summary =
    status === ''
      ? 'Pick what happened'
      : confirming && guestCount > 0
        ? `${outcomeWord(status)} · ${guestCount} guest${guestCount === 1 ? '' : 's'}`
        : outcomeWord(status)

  return (
    <div className="flex flex-col gap-4 pb-nav-bottombar">
      {/* WHO AM I LOGGING. The shell's header names the SECTION ("Calls"); the
          record's own identity is the first thing in the body, which is the
          v3 rule for every detail screen. */}
      <section
        className="flex items-start gap-3 rounded-2xl border border-rule bg-surface p-4 shadow-e1"
        aria-label={`Family: ${group.head_name}`}
      >
        <span
          aria-hidden
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-base font-semibold text-ink"
        >
          {initials(group.head_name)}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="line-clamp-2 font-display text-xl leading-tight font-semibold break-words text-ink">
            {group.head_name}
          </h2>
          <p className="mt-1 truncate text-sm text-muted">{metaLine}</p>
        </div>
        <span className="flex shrink-0 items-center gap-2 pt-1">
          <span
            aria-hidden
            className={cn(
              'h-2.5 w-2.5 rounded-full',
              group.rsvp_status === 'confirmed'
                ? 'bg-ledger-green'
                : group.rsvp_status === 'declined' || group.rsvp_status === 'unreachable'
                  ? 'bg-ledger-red'
                  : 'bg-subtle',
            )}
          />
          <span className="text-sm font-medium text-muted">
            {outcomeWord(group.rsvp_status ?? 'not_started')}
          </span>
        </span>
      </section>

      {/* THE JOB: one outcome. Five chips, one tap, no prose. */}
      <section className="flex flex-col gap-2.5" aria-labelledby="outcome-heading">
        <h3 id="outcome-heading" className="text-sm font-medium text-muted">
          What happened?
        </h3>
        <div className="flex flex-wrap gap-2" role="group" aria-label="What happened">
          {OUTCOMES.map((option) => (
            <Chip
              key={option.value}
              selected={status === option.value}
              tone={statusTone(option.value)}
              onClick={() => updateField('rsvpStatus', option.value)}
            >
              {option.label}
            </Chip>
          ))}
        </div>
        {statusError ? (
          <p role="alert" className="text-sm font-medium text-ledger-red">
            {statusError}
          </p>
        ) : null}
      </section>

      {confirming ? (
        <section className="flex flex-col gap-3 rounded-2xl border border-rule bg-surface p-4">
          <div className="flex flex-col gap-3">
            <Stepper
              label="Adults"
              value={toDisplayCount(values.adultsConfirmed)}
              onChange={(v) => updateField('adultsConfirmed', v > 0 ? String(v) : '')}
            />
            <Stepper
              label="Kids"
              value={toDisplayCount(values.childrenConfirmed)}
              onChange={(v) => updateField('childrenConfirmed', v > 0 ? String(v) : '')}
            />
          </div>
          <p className="text-sm text-muted">
            {guestCount > 0
              ? `${guestCount} ${guestCount === 1 ? 'guest' : 'guests'} coming`
              : 'Add at least one guest'}
          </p>
        </section>
      ) : null}

      {collapsed ? (
        <p className="rounded-xl border border-rule bg-surface-2 px-3.5 py-3 text-sm text-muted">
          {status === 'declined'
            ? 'Not coming — nothing else to fill in.'
            : 'No answer — nothing else to fill in.'}
        </p>
      ) : null}

      {showCallback ? (
        <section className="flex flex-col gap-3 rounded-2xl border border-rule bg-surface p-4">
          <Input
            type="datetime-local"
            label="Call back at"
            required
            min={toDatetimeLocalValue(new Date())}
            value={values.callbackDatetime}
            onChange={(e) => updateField('callbackDatetime', e.target.value)}
            aria-invalid={fieldErrors['callbackDatetime'] ? true : undefined}
            error={fieldErrors['callbackDatetime'] ?? null}
          />
        </section>
      ) : null}

      {status === 'confirmed' ? (
        <ConfirmedDetails
          values={values}
          fieldErrors={fieldErrors}
          updateField={updateField}
          updateLeg={updateLeg}
          toggleRequirement={toggleRequirement}
        />
      ) : null}

      <Textarea
        label="Notes"
        hint="Optional"
        value={values.notes}
        onChange={(e) => updateField('notes', e.target.value)}
        rows={2}
      />

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-ledger-red/40 bg-red-tint px-3.5 py-3 text-sm font-medium text-ledger-red"
        >
          {error}
        </p>
      ) : null}

      {hasEarlierAttempts ? (
        <PreviousAttempts attempts={previousAttempts} viewerId={viewerId} />
      ) : null}

      {/* The screen's ONE primary action. The lock-release work and the
          navigation live in handleSave and are unchanged. */}
      <BottomBar
        summary={summary}
        primary={{
          label: 'Save outcome',
          onPress: () => void handleSave(),
          disabled: status === '' || saving,
        }}
      />
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

/**
 * The travel panel for a confirmed family.
 *
 * DEPARTURE IS BEHIND A DISCLOSURE, as it was before: most calls confirm the
 * arrival and the caller does not know the return yet, and ten inputs on one
 * screen is the thing the v3 look exists to remove.
 */
function ConfirmedDetails({
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
  const [showDeparture, setShowDeparture] = useState(
    // Open on load only when there is already a departure on record, so a
    // caller who is correcting one does not have to find it first.
    Boolean(values.departure.date || values.departure.time || values.departure.flightTrainNo),
  )

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-rule bg-surface p-4">
      <TravelLegSection
        direction="arrival"
        title="Arrival"
        values={values.arrival}
        fieldErrors={fieldErrors}
        onChange={(field, value) => updateLeg('arrival', field, value)}
      />

      <button
        type="button"
        onClick={() => setShowDeparture((v) => !v)}
        aria-expanded={showDeparture}
        className="tap flex min-h-11 items-center justify-between gap-2 rounded-xl border border-rule bg-surface-2 px-3.5 text-left"
      >
        <span className="text-sm font-medium text-ink">
          Departure
          {!showDeparture && values.departure.date ? ` · ${values.departure.date}` : ''}
        </span>
        {showDeparture ? (
          <ChevronDownIcon className="h-5 w-5 shrink-0 text-muted" aria-hidden />
        ) : (
          <ChevronRightIcon className="h-5 w-5 shrink-0 text-muted" aria-hidden />
        )}
      </button>

      {showDeparture ? (
        <TravelLegSection
          direction="departure"
          title="Return travel"
          values={values.departure}
          fieldErrors={fieldErrors}
          onChange={(field, value) => updateLeg('departure', field, value)}
        />
      ) : null}

      <div className="flex items-center justify-between gap-3 border-t border-rule pt-3">
        <span className="text-sm font-medium text-ink">Needs pickup</span>
        <button
          type="button"
          role="switch"
          aria-checked={values.needsPickup}
          onClick={() => updateField('needsPickup', !values.needsPickup)}
          className={cn(
            'tap relative inline-flex h-7 w-12 shrink-0 rounded-full border-2 border-transparent transition-colors',
            values.needsPickup ? 'bg-brand' : 'bg-rule-strong',
          )}
        >
          <span
            className={cn(
              'inline-block h-6 w-6 rounded-full bg-surface shadow transition-transform',
              values.needsPickup ? 'translate-x-5' : 'translate-x-0',
            )}
          />
        </button>
      </div>

      <div className="flex flex-col gap-2 border-t border-rule pt-3">
        <span className="text-sm font-medium text-ink">Special requirements</span>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Special requirements">
          {SPECIAL_REQUIREMENTS_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              selected={values.specialRequirements.includes(option.value)}
              onClick={() => toggleRequirement(option.value)}
            >
              {option.label}
            </Chip>
          ))}
        </div>
      </div>
    </section>
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
      <p className="text-sm font-medium text-muted">{title}</p>
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
        <p role="alert" className="text-sm font-medium text-ledger-red">
          {fieldErrors[dateKey]}
        </p>
      ) : null}
      <Input
        label="Point"
        value={values.location}
        onChange={(e) => onChange('location', e.target.value)}
      />
      <Input
        label={direction === 'arrival' ? 'Flight / train no.' : 'Return flight / train no.'}
        value={values.flightTrainNo}
        onChange={(e) => onChange('flightTrainNo', e.target.value)}
        className="code-figure"
      />
    </div>
  )
}

/**
 * Earlier calls, as compact v3 rows.
 *
 * BELOW the form, not above it: the job is the outcome, and a caller arriving
 * to log a call should not have to scroll past history to reach the five
 * chips. The rows are evidence for a caller who wants it, which is what puts
 * them after the thing they are evidence about.
 */
function PreviousAttempts({
  attempts,
  viewerId,
}: {
  attempts: CallAttemptRow[]
  viewerId: string
}) {
  return (
    <section className="flex flex-col gap-2" aria-labelledby="previous-calls-heading">
      <h3 id="previous-calls-heading" className="text-sm font-medium text-muted">
        Earlier calls
      </h3>
      <ul
        className="flex flex-col overflow-hidden rounded-2xl border border-rule bg-surface"
        role="list"
      >
        {attempts.map((attempt) => {
          const label = attempt.outcome
            ? (outcomeOption(attempt.outcome)?.label ?? attempt.outcome)
            : 'No outcome'
          const who =
            attempt.caller_id === viewerId || attempt.caller_id_staff === viewerId
              ? 'You'
              : 'Another caller'
          return (
            <li key={attempt.id}>
              <Row
                heading={formatDateTime(attempt.started_at)}
                meta={`${who} · dialed ${formatMobile(attempt.dialed_number)}`}
                status={label}
                tone={outcomeRowTone(attempt.outcome ?? '')}
              />
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function SavedState({ hasQueueNext }: { hasQueueNext: boolean }) {
  return (
    <div className="my-auto flex flex-col items-center gap-3 py-12 text-center">
      <span
        aria-hidden
        className="flex h-14 w-14 items-center justify-center rounded-full bg-green-tint text-ledger-green"
      >
        <CheckCircleIcon className="h-8 w-8" />
      </span>
      <p className="font-display text-xl font-semibold text-ink">Saved</p>
      <p className="max-w-xs text-sm text-muted">
        {hasQueueNext ? 'Opening the next family…' : 'This RSVP is recorded.'}
      </p>
    </div>
  )
}

export default RsvpLogForm
