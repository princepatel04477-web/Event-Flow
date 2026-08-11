'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardFooter, CardHeader, CardTitle } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import {
  ArrowDownCircleIcon,
  ArrowUpCircleIcon,
  CheckCircleIcon,
  ClockIcon,
  InboxIcon,
  PhoneIcon,
} from '@/components/icons'
import { cn, formatDateTime, formatDuration } from '@/lib/utils'
import { rsvpStatusLabel, rsvpStatusTone } from '@/lib/rsvp'

import { BackRow } from './BackRow'
import { startCallAttempt, submitCallOutcome } from '@/lib/actions/call'
import { dialTarget, formatMobile, type DialTarget } from '@/lib/phone'
import { placeCall } from '@/lib/native-call'
import { drainOutbox, listQueuedCompletions, queueCompletion } from '@/lib/call/outbox'
import { clearStoredAttempt, getStoredAttempt, setStoredAttempt, type StoredCallAttempt } from '@/lib/call/session'
import {
  CALL_OUTCOMES,
  MAX_PLAUSIBLE_CALL_SEC,
  outcomeOption,
  type CallAttemptRow,
  type CallCompletionPayload,
  type CallOutcome,
  type GuestGroupRow,
  type TravelLegRow,
} from '@/lib/call/types'
import { VoiceNoteRecorder } from '@/components/voice-note/VoiceNoteRecorder'

export interface CallScreenProps {
  eventId: string
  eventCode: string
  viewerId: string
  group: GuestGroupRow
  attempts: CallAttemptRow[]
  travelLegs: TravelLegRow[]
  inFlightAttempt: CallAttemptRow | null
}

type Phase = 'idle' | 'awaiting_outcome' | 'submitted'

/** The honest outcome for "the dialer opened but no call happened". */
const NOT_DIALLED_OUTCOME: CallOutcome = 'other'
const NOT_DIALLED_NOTE = 'Attempt closed without a call — the dialer was cancelled or never connected.'

export function CallScreen({
  eventId,
  eventCode,
  viewerId,
  group,
  attempts,
  travelLegs,
  inFlightAttempt,
}: CallScreenProps) {
  const router = useRouter()

  const [phase, setPhase] = useState<Phase>('idle')
  const [activeAttempt, setActiveAttempt] = useState<StoredCallAttempt | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const [starting, setStarting] = useState<'primary' | 'alt' | null>(null)

  const [outcome, setOutcome] = useState<CallOutcome | null>(null)
  const [notes, setNotes] = useState('')
  const [callbackAt, setCallbackAt] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [savedOffline, setSavedOffline] = useState(false)
  const [queuedCount, setQueuedCount] = useState(0)

  // ---------------------------------------------------------------------
  // Resume-first: rehydrate an in-flight attempt on mount. sessionStorage
  // is the fast path; the server-detected `inFlightAttempt` (a call_attempts
  // row this caller left with no outcome) is the fallback for when
  // sessionStorage was cleared but the call really did happen.
  // sessionStorage genuinely differs between the server-rendered pass (no
  // `window`) and the client, so this cannot be a lazy `useState` initializer
  // without risking a hydration mismatch — it has to run post-mount, client
  // only, hence the effect despite the lint rule's general preference.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const stored = getStoredAttempt(group.id)

    if (stored) {
      const serverRow = attempts.find((a) => a.id === stored.attemptId)
      if (serverRow && serverRow.outcome !== null) {
        // Finalized elsewhere (e.g. the offline outbox synced from another
        // tab) since we last stored this — nothing left to resume.
        clearStoredAttempt(group.id)
      } else {
        // Android frequently DESTROYS the page while the dialer is open, so
        // this mount is itself "the caller came back" — `visibilitychange`
        // will never fire for that trip. Stamp the return here if the dial
        // fired in a session that stored `dialedAt`.
        const resumed: StoredCallAttempt =
          stored.dialedAt !== undefined && stored.returnedAt === undefined
            ? { ...stored, returnedAt: Date.now() }
            : stored
        if (resumed !== stored) setStoredAttempt(resumed)
        setActiveAttempt(resumed)
        setPhase('awaiting_outcome')
        return
      }
    }

    if (inFlightAttempt) {
      const entry: StoredCallAttempt = {
        attemptId: inFlightAttempt.id,
        groupId: group.id,
        eventId,
        dialedNumber: inFlightAttempt.dialed_number,
        startedAt: inFlightAttempt.started_at,
        // No dialedAt: this attempt was recovered from the server, so there
        // is no trustworthy local clock reading for when the dial fired.
      }
      setStoredAttempt(entry)
      setActiveAttempt(entry)
      setPhase('awaiting_outcome')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.id])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Record the moment the caller comes back from the dialer. That instant —
  // not "when we finish typing notes", and certainly not "when the row was
  // inserted" — is the end of the call for duration purposes.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== 'visible') return
      setActiveAttempt((prev) => {
        if (!prev || prev.dialedAt === undefined || prev.returnedAt !== undefined) return prev
        const next = { ...prev, returnedAt: Date.now() }
        setStoredAttempt(next)
        return next
      })
    }

    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  // Drain the offline outbox whenever we come back online, and once on mount
  // in case something was queued in an earlier session on this device.
  useEffect(() => {
    let cancelled = false

    async function drain() {
      const { synced } = await drainOutbox(submitCallOutcome)
      if (cancelled) return
      if (synced.length > 0) router.refresh()
      const remaining = await listQueuedCompletions()
      if (!cancelled) setQueuedCount(remaining.length)
    }

    void drain()
    window.addEventListener('online', drain)
    return () => {
      cancelled = true
      window.removeEventListener('online', drain)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const primaryTarget = dialTarget(group.primary_mobile)
  const altTarget = dialTarget(group.alt_mobile)

  const pastAttempts = useMemo(
    () => attempts.filter((a) => a.id !== activeAttempt?.attemptId),
    [attempts, activeAttempt],
  )

  async function handleStartCall(which: 'primary' | 'alt') {
    const target = which === 'primary' ? primaryTarget : altTarget
    if (!target) return

    setStartError(null)
    setStarting(which)

    let result: Awaited<ReturnType<typeof startCallAttempt>>
    try {
      result = await startCallAttempt({
        eventId,
        groupId: group.id,
        dialedNumber: target.dialedNumber,
        deviceStartedAt: new Date().toISOString(),
      })
    } catch {
      // No data connection (a basement, venue Wi-Fi with no uplink) — the
      // server action's fetch rejects. Without this catch, `setStarting(null)`
      // and the dial itself were both skipped and the Call buttons spun
      // forever with no error and no call.
      setStarting(null)
      setStartError(
        'No connection, so this call could not be logged — and a call that is not logged is a call that never happened. ' +
          'Move to where there is signal and try again.',
      )
      return
    }

    setStarting(null)

    if (!result.ok) {
      setStartError(result.message)
      return
    }

    const entry: StoredCallAttempt = {
      attemptId: result.attempt.id,
      groupId: group.id,
      eventId,
      dialedNumber: target.dialedNumber,
      startedAt: result.attempt.started_at,
      dialedAt: Date.now(),
    }
    setStoredAttempt(entry)
    setActiveAttempt(entry)
    setOutcome(null)
    setNotes('')
    setCallbackAt('')
    setConfirming(false)
    setSubmitError(null)
    setPhase('awaiting_outcome')

    // The row is written and stashed BEFORE we dial — this is the one thing
    // that must never be reordered. See the module doc in lib/call/session.ts.
    await placeCall(target)
  }

  /**
   * Re-fire the dialer for an attempt that is already open. Deliberately
   * does NOT create a second call_attempts row: backing out of the Android
   * dialer and trying again is one attempt, not two.
   */
  function handleRedial() {
    if (!activeAttempt) return
    const target = dialTarget(activeAttempt.dialedNumber)
    if (!target) return
    setActiveAttempt((prev) => {
      if (!prev) return prev
      const next = { ...prev, dialedAt: Date.now(), returnedAt: undefined }
      setStoredAttempt(next)
      return next
    })
    // Same path as the first dial — a redial used to skip the native plugin
    // entirely and go straight to the system handoff.
    void placeCall(target)
  }

  function buildPayload(
    chosen: CallOutcome,
    chosenNotes: string | null,
    chosenCallbackAt: string | null,
  ): CallCompletionPayload | null {
    if (!activeAttempt) return null

    const endedAt = new Date()

    // Duration is the span from the dial firing to the caller coming back
    // from the dialer — both read from THIS phone, in this session. When we
    // do not have both (an attempt resumed from the server, a page that was
    // never backgrounded), it is genuinely unknown and is written as null.
    // The old code measured from the server insert timestamp, so an attempt
    // resumed on Wednesday for a call dialled on Monday wrote 172800 seconds
    // and then froze that value permanently.
    let durationSec: number | null = null
    if (activeAttempt.dialedAt !== undefined && activeAttempt.returnedAt !== undefined) {
      const seconds = Math.round((activeAttempt.returnedAt - activeAttempt.dialedAt) / 1000)
      if (seconds >= 0 && seconds <= MAX_PLAUSIBLE_CALL_SEC) durationSec = seconds
    }

    return {
      attemptId: activeAttempt.attemptId,
      eventId,
      eventCode,
      groupId: group.id,
      outcome: chosen,
      notes: chosenNotes,
      callbackAt: chosenCallbackAt,
      endedAt: endedAt.toISOString(),
      durationSec,
    }
  }

  /** Re-read the outbox rather than incrementing — the store is keyed by
   *  attemptId, so re-queuing the same completion is not a new item. */
  async function refreshQueuedCount() {
    const remaining = await listQueuedCompletions()
    setQueuedCount(remaining.length)
  }

  async function sendCompletion(payload: CallCompletionPayload) {
    setSaving(true)
    setSubmitError(null)

    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false

    if (isOffline) {
      await queueCompletion(payload)
      clearStoredAttempt(group.id)
      setSavedOffline(true)
      setSaving(false)
      setPhase('submitted')
      await refreshQueuedCount()
      return
    }

    try {
      const result = await submitCallOutcome(payload)
      if (result.ok || result.alreadyFinalized) {
        clearStoredAttempt(group.id)
        setSavedOffline(false)
        setSaving(false)
        setPhase('submitted')
        return
      }
      // NOT saved — and a zero-row update now reports that honestly instead
      // of claiming success. Keep the outcome on the phone rather than
      // losing it, stay on this screen, and say what happened.
      await queueCompletion(payload)
      setSaving(false)
      setConfirming(false)
      setSubmitError(result.message)
      await refreshQueuedCount()
    } catch {
      // Could not even reach the server — queue it rather than lose the outcome.
      await queueCompletion(payload)
      clearStoredAttempt(group.id)
      setSavedOffline(true)
      setSaving(false)
      setPhase('submitted')
      await refreshQueuedCount()
    }
  }

  const callbackProblem = describeCallbackProblem(outcome, callbackAt)

  async function handleConfirmSubmit() {
    if (!activeAttempt || !outcome || callbackProblem) return

    const payload = buildPayload(
      outcome,
      notes.trim() ? notes.trim() : null,
      outcome === 'callback' && callbackAt ? new Date(callbackAt).toISOString() : null,
    )
    if (!payload) return

    await sendCompletion(payload)
  }

  /**
   * Close an attempt where no call actually took place.
   *
   * This exists because an attempt row with `outcome IS NULL` makes the
   * family permanently un-dialable BY THIS CALLER: the page forces
   * `awaiting_outcome` on every visit and the Call button only renders when
   * idle. The old "Abandon" button just cleared sessionStorage and walked
   * away, leaving that row behind — every caller who ever backed out of a
   * dial bricked that family for themselves.
   *
   * It records `other` with a note stating plainly what happened, rather
   * than inventing "no answer" for a call that was never placed.
   */
  async function handleCloseWithoutCall() {
    if (!activeAttempt) return
    const payload = buildPayload(NOT_DIALLED_OUTCOME, NOT_DIALLED_NOTE, null)
    if (!payload) return
    await sendCompletion({ ...payload, durationSec: null })
  }

  function handleCallAgain() {
    if (!activeAttempt) return
    setPhase('idle')
    setActiveAttempt(null)
  }

  return (
    <div className="flex flex-col gap-4">
      <BackRow
        href={`/${eventCode}/rsvp/queue`}
        title={group.head_name}
        subtitle={[formatMobile(group.primary_mobile), group.city].filter(Boolean).join(' · ')}
      />

      <>
        {/* Lock state removed 2026-08-12 — caller lock is dormant. */}

        {/* Group context */}
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 className="truncate text-lg font-semibold text-fg">{group.head_name}</h2>
              <p className="text-sm text-muted">
                {group.group_type} · {formatPax(group)}
              </p>
            </CardTitle>
            <Badge tone={rsvpStatusTone(group.rsvp_status)} size="md">
              {rsvpStatusLabel(group.rsvp_status)}
            </Badge>
          </CardHeader>
          <CardBody className="flex flex-col gap-2 text-sm">
            <Row label="Side" value={group.side ?? '—'} />
            <Row label="City" value={group.city ?? '—'} />
            <Row label="Primary mobile" value={formatMobile(group.primary_mobile)} />
            {group.alt_mobile ? <Row label="Alt mobile" value={formatMobile(group.alt_mobile)} /> : null}
            <Row label="Priority" value={String(group.priority)} />
            {group.remarks ? (
              <div className="mt-1 rounded-xl bg-surface-2 px-3 py-2">
                <p className="text-xs font-medium text-muted">Remarks</p>
                <p className="mt-0.5 text-sm text-fg">{group.remarks}</p>
              </div>
            ) : null}
          </CardBody>
        </Card>

        {/* Travel legs */}
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 className="text-base font-semibold text-fg">Travel</h2>
            </CardTitle>
          </CardHeader>
          <CardBody>
            {travelLegs.length === 0 ? (
              <p className="text-sm text-muted">No arrival or departure on file yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {travelLegs.map((leg) => (
                  <li key={leg.id} className="flex items-start gap-2.5 text-sm">
                    {leg.direction === 'arrival' ? (
                      <ArrowDownCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-info" />
                    ) : (
                      <ArrowUpCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-muted" />
                    )}
                    <div className="min-w-0">
                      <p className="font-medium text-fg">
                        {leg.direction === 'arrival' ? 'Arrival' : 'Departure'}
                        {leg.mode ? ` · ${leg.mode}` : ''}
                        {leg.travel_date ? ` · ${leg.travel_date}` : ''}
                        {leg.travel_time ? ` ${leg.travel_time}` : ''}
                      </p>
                      <p className="truncate text-muted">
                        {[leg.reference, leg.point].filter(Boolean).join(' · ') || 'No further detail'}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {/* Call action */}
        {phase === 'idle' ? (
          <CallButtons
            primary={primaryTarget}
            alt={altTarget}
            starting={starting}
            error={startError}
            onCall={handleStartCall}
          />
        ) : null}

        {phase === 'awaiting_outcome' && activeAttempt ? (
          <OutcomeCard
            activeAttempt={activeAttempt}
            outcome={outcome}
            notes={notes}
            callbackAt={callbackAt}
            callbackProblem={callbackProblem}
            confirming={confirming}
            saving={saving}
            error={submitError}
            onOutcomeChange={setOutcome}
            onNotesChange={setNotes}
            onCallbackAtChange={setCallbackAt}
            onReviewSubmit={() => setConfirming(true)}
            onCancelConfirm={() => setConfirming(false)}
            onConfirm={handleConfirmSubmit}
            onRedial={handleRedial}
            onCloseWithoutCall={handleCloseWithoutCall}
          />
        ) : null}

        {phase === 'submitted' ? (
          <>
            {!savedOffline && activeAttempt ? (
              <VoiceNoteRecorder
                eventId={eventId}
                groupId={group.id}
                callAttemptId={activeAttempt.attemptId}
              />
            ) : null}
            <Card>
              <CardBody className="flex flex-col items-center gap-2 py-6 text-center">
                {savedOffline ? (
                  <>
                    <ClockIcon className="h-8 w-8 text-warning" />
                    <p className="text-base font-semibold text-fg">Saved on this phone</p>
                    <p className="max-w-xs text-sm text-muted">
                      No signal right now — this outcome will sync automatically the moment you are
                      back online. It is not lost.
                    </p>
                  </>
                ) : (
                  <>
                    <CheckCircleIcon className="h-8 w-8 text-success" />
                    <p className="text-base font-semibold text-fg">Outcome saved</p>
                    <p className="text-sm text-muted">This record cannot be edited from here on.</p>
                  </>
                )}
              </CardBody>
              <CardFooter className="flex flex-col gap-2">
                <Button fullWidth variant="primary" onClick={() => router.push(`/${eventCode}/rsvp/queue`)}>
                  Back to queue
                </Button>
                <div className="flex w-full gap-2">
                  <Button
                    variant="secondary"
                    fullWidth
                    onClick={handleCallAgain}
                    disabled={!primaryTarget && !altTarget}
                  >
                    Call again
                  </Button>
                </div>
              </CardFooter>
            </Card>
          </>
        ) : null}

        {queuedCount > 0 ? (
          <p className="text-center text-xs text-subtle">
            {queuedCount} call{queuedCount === 1 ? '' : 's'} on this phone still waiting to sync.
          </p>
        ) : null}

        {/* Previous attempts */}
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 className="text-base font-semibold text-fg">
                Previous attempts ({pastAttempts.length})
              </h2>
            </CardTitle>
          </CardHeader>
          <CardBody>
            {pastAttempts.length === 0 ? (
              <EmptyState
                icon={<InboxIcon className="h-6 w-6" />}
                title="No earlier attempts"
                description="This will be the first time this family has been called."
              />
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {pastAttempts.map((attempt) => (
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
                      Dialed {formatMobile(attempt.dialed_number)}
                      {attempt.duration_sec !== null
                        ? ` · ${formatDuration(attempt.duration_sec)}`
                        : ''}
                      {(attempt.caller_id === viewerId || attempt.caller_id_staff === viewerId)
                        ? ' · you'
                        : ''}
                    </p>
                    {attempt.notes ? <p className="text-sm text-fg">{attempt.notes}</p> : null}
                    {attempt.callback_at ? (
                      <p className="text-xs text-info">
                        Callback requested: {formatDateTime(attempt.callback_at)}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {/* Recording placeholder — audio capture/transcription/extraction ships in p1g/p1h. */}
        <Card flat className="border border-dashed border-border bg-transparent">
          <CardBody className="flex flex-col items-center gap-1 py-6 text-center">
            <PhoneIcon className="h-6 w-6 text-subtle" />
            <p className="text-sm font-medium text-muted">Call recording not available yet</p>
            <p className="max-w-xs text-xs text-subtle">
              The native recorder (p1g) and transcription/extraction (p1h) mount here once built.
              For now, capture what was said in the notes field above.
            </p>
          </CardBody>
        </Card>

        {phase === 'idle' ? (
          <Button
            variant="ghost"
            onClick={() => { clearStoredAttempt(group.id); router.push(`/${eventCode}/rsvp/queue`) }}
            className="self-center"
          >
            Back to queue
          </Button>
        ) : null}
      </>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * A `callback` outcome with no time (or a time already gone) produces a
 * family that never resurfaces: `v_rsvp_queue.next_callback_at` only counts
 * `callback_at > now()`, and the row freezes the moment the outcome is
 * written, so the missing time can never be added afterwards — by anyone.
 */
function describeCallbackProblem(outcome: CallOutcome | null, callbackAt: string): string | null {
  if (outcome !== 'callback') return null
  if (!callbackAt.trim()) {
    return 'Pick when to call back. Without a time this family drops out of the callback list for good — the record freezes on save and the time can never be added.'
  }
  const when = new Date(callbackAt)
  if (Number.isNaN(when.getTime())) return 'That callback time could not be read. Pick it again.'
  if (when.getTime() <= Date.now()) {
    return 'That time has already passed, so the family would never appear under booked callbacks. Pick a time in the future.'
  }
  return null
}

/** `datetime-local` wants "YYYY-MM-DDTHH:MM" in LOCAL time, not an ISO/UTC string. */
function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="truncate font-medium text-fg">{value}</span>
    </div>
  )
}

function CallButtons({
  primary,
  alt,
  starting,
  error,
  onCall,
}: {
  primary: DialTarget | null
  alt: DialTarget | null
  starting: 'primary' | 'alt' | null
  error: string | null
  onCall: (which: 'primary' | 'alt') => void
}) {
  if (!primary && !alt) {
    return (
      <Card>
        <CardBody>
          <EmptyState
            icon={<PhoneIcon className="h-6 w-6" />}
            title="No dialable number on file"
            description="Neither number on this family reduces to a valid mobile — rather than dial a guess, nothing is offered. Fix it in the Excel source and re-import before calling."
          />
        </CardBody>
      </Card>
    )
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        {primary ? (
          <Button
            size="lg"
            fullWidth
            leadingIcon={<PhoneIcon className="h-5 w-5" />}
            loading={starting === 'primary'}
            disabled={starting !== null}
            onClick={() => onCall('primary')}
          >
            Call {primary.label}
          </Button>
        ) : null}

        {alt ? (
          <Button
            variant="secondary"
            size="md"
            fullWidth
            leadingIcon={<PhoneIcon className="h-4 w-4" />}
            loading={starting === 'alt'}
            disabled={starting !== null}
            onClick={() => onCall('alt')}
          >
            Call alternate {alt.label}
          </Button>
        ) : null}

        {primary?.international || alt?.international ? (
          <p className="text-xs text-muted">
            This is an international number — it will be dialled exactly as stored, not as +91.
          </p>
        ) : null}

        {error ? <p className="text-sm font-medium text-danger">{error}</p> : null}
      </CardBody>
    </Card>
  )
}

function OutcomeCard({
  activeAttempt,
  outcome,
  notes,
  callbackAt,
  callbackProblem,
  confirming,
  saving,
  error,
  onOutcomeChange,
  onNotesChange,
  onCallbackAtChange,
  onReviewSubmit,
  onCancelConfirm,
  onConfirm,
  onRedial,
  onCloseWithoutCall,
}: {
  activeAttempt: StoredCallAttempt
  outcome: CallOutcome | null
  notes: string
  callbackAt: string
  callbackProblem: string | null
  confirming: boolean
  saving: boolean
  error: string | null
  onOutcomeChange: (value: CallOutcome) => void
  onNotesChange: (value: string) => void
  onCallbackAtChange: (value: string) => void
  onReviewSubmit: () => void
  onCancelConfirm: () => void
  onConfirm: () => void
  onRedial: () => void
  onCloseWithoutCall: () => void
}) {
  if (confirming && outcome) {
    const option = outcomeOption(outcome)
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-base font-semibold text-fg">Confirm before saving</h2>
          </CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-2">
          <p className="text-sm text-muted">
            This call record freezes the moment you save it — nobody, not even an admin, can edit
            it afterwards.
          </p>
          <div className="rounded-xl bg-surface-2 px-3.5 py-3">
            <p className="text-sm font-semibold text-fg">{option?.label ?? outcome}</p>
            {outcome === 'callback' && callbackAt ? (
              <p className="mt-1 text-sm text-muted">Callback at {callbackAt.replace('T', ' ')}</p>
            ) : null}
            {notes ? <p className="mt-1 text-sm text-muted">{notes}</p> : null}
          </div>
          {error ? <p className="text-sm font-medium text-danger">{error}</p> : null}
        </CardBody>
        <CardFooter className="flex gap-2">
          <Button variant="secondary" fullWidth onClick={onCancelConfirm} disabled={saving}>
            Go back
          </Button>
          <Button variant="primary" fullWidth onClick={onConfirm} loading={saving}>
            Yes, save it
          </Button>
        </CardFooter>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="text-base font-semibold text-fg">How did the call go?</h2>
          <p className="text-sm text-muted">Dialed {formatMobile(activeAttempt.dialedNumber)}</p>
        </CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2">
          {CALL_OUTCOMES.map((opt) => {
            const selected = outcome === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                aria-pressed={selected}
                onClick={() => onOutcomeChange(opt.value)}
                className={cn(
                  'tap flex min-h-14 flex-col items-start justify-center gap-0.5 rounded-xl border px-3 py-2 text-left transition-colors',
                  selected
                    ? 'border-brand bg-brand text-brand-fg'
                    : 'border-border-strong bg-surface text-fg hover:bg-surface-2',
                )}
              >
                <span className="text-sm font-semibold">{opt.label}</span>
                {opt.hint ? (
                  <span className={cn('text-xs', selected ? 'text-brand-fg/80' : 'text-muted')}>
                    {opt.hint}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>

        {outcome === 'callback' ? (
          <div>
            <Input
              type="datetime-local"
              label="Call back at"
              required
              min={toDatetimeLocalValue(new Date())}
              value={callbackAt}
              onChange={(e) => onCallbackAtChange(e.target.value)}
              aria-invalid={callbackProblem ? true : undefined}
            />
            {callbackProblem ? (
              <p className="mt-1 text-sm font-medium text-danger">{callbackProblem}</p>
            ) : null}
          </div>
        ) : null}

        <Textarea
          label="Notes (optional)"
          placeholder="Anything useful for next time — who you spoke to, what they said"
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
        />

        {error ? <p className="text-sm font-medium text-danger">{error}</p> : null}
      </CardBody>
      <CardFooter className="flex flex-col gap-2">
        <Button fullWidth disabled={!outcome || callbackProblem !== null} onClick={onReviewSubmit}>
          Save outcome
        </Button>

        {/* Two honest ways out of an open attempt, so nobody is ever forced
            to invent an outcome and nobody can strand a null-outcome row
            that hides the Call button from them forever. */}
        <div className="flex w-full gap-2">
          <Button variant="secondary" fullWidth onClick={onRedial} disabled={saving}>
            Dial again
          </Button>
          <Button variant="ghost" fullWidth onClick={onCloseWithoutCall} loading={saving}>
            No call happened
          </Button>
        </div>
        <p className="text-center text-xs text-subtle">
          &ldquo;No call happened&rdquo; closes this attempt as <em>Other</em> with a note saying
          the dialer was cancelled. It is recorded, not erased.
        </p>
      </CardFooter>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatPax(group: GuestGroupRow): string {
  const confirmed = group.confirmed_pax
  if (confirmed !== null) return `${confirmed} confirmed pax`
  return `${group.expected_pax} expected pax`
}

function formatCountdown(ms: number | null): string {
  if (ms === null) return ''
  const clamped = Math.max(0, ms)
  const totalSec = Math.floor(clamped / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export default CallScreen
