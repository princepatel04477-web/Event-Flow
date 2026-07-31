'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { format } from 'date-fns'

import { Badge, type BadgeTone } from '@/components/ui/Badge'
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
import { cn } from '@/lib/utils'

import { BackRow } from './BackRow'
import { claimGroupForCall, releaseGroupAfterCall, startCallAttempt, submitCallOutcome } from '@/lib/actions/call'
import { formatMobile, normalizeMobile, telHref } from '@/lib/call/phone'
import { drainOutbox, listQueuedCompletions, queueCompletion } from '@/lib/call/outbox'
import { clearStoredAttempt, getStoredAttempt, setStoredAttempt, type StoredCallAttempt } from '@/lib/call/session'
import {
  CALL_OUTCOMES,
  outcomeOption,
  type CallAttemptRow,
  type CallCompletionPayload,
  type CallOutcome,
  type GuestGroupRow,
  type TravelLegRow,
} from '@/lib/call/types'

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

const RSVP_TONES: Record<string, BadgeTone> = {
  not_started: 'neutral',
  attempted: 'info',
  callback: 'info',
  tentative: 'warning',
  confirmed: 'success',
  declined: 'danger',
  unreachable: 'danger',
}

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

  const [lockedUntil, setLockedUntil] = useState(group.locked_until)
  const [extending, setExtending] = useState(false)

  const [releasing, setReleasing] = useState(false)
  const [queuedCount, setQueuedCount] = useState(0)

  const [now, setNow] = useState(() => Date.now())

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
        setActiveAttempt(stored)
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
      }
      setStoredAttempt(entry)
      setActiveAttempt(entry)
      setPhase('awaiting_outcome')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.id])
  /* eslint-enable react-hooks/set-state-in-effect */

  // Lock countdown ticks every second purely for display.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
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

    drain()
    window.addEventListener('online', drain)
    return () => {
      cancelled = true
      window.removeEventListener('online', drain)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const remainingMs = lockedUntil ? new Date(lockedUntil).getTime() - now : null
  const lockLabel = formatCountdown(remainingMs)
  const lockExpiringSoon = remainingMs !== null && remainingMs > 0 && remainingMs < 60_000
  const lockExpired = remainingMs !== null && remainingMs <= 0

  const primaryDigits = normalizeMobile(group.primary_mobile)
  const altDigits = normalizeMobile(group.alt_mobile)

  const pastAttempts = useMemo(
    () => attempts.filter((a) => a.id !== activeAttempt?.attemptId),
    [attempts, activeAttempt],
  )

  async function handleStartCall(which: 'primary' | 'alt') {
    const digits = which === 'primary' ? primaryDigits : altDigits
    if (!digits) return

    setStartError(null)
    setStarting(which)

    const result = await startCallAttempt({ eventId, groupId: group.id, dialedNumber: digits })

    setStarting(null)

    if (!result.ok) {
      setStartError(result.message)
      return
    }

    const entry: StoredCallAttempt = {
      attemptId: result.attempt.id,
      groupId: group.id,
      eventId,
      dialedNumber: digits,
      startedAt: result.attempt.started_at,
    }
    setStoredAttempt(entry)
    setActiveAttempt(entry)
    setOutcome(null)
    setNotes('')
    setCallbackAt('')
    setConfirming(false)
    setSubmitError(null)
    setPhase('awaiting_outcome')

    // The row is written and stashed BEFORE we navigate — this is the one
    // thing that must never be reordered. See the module doc in
    // lib/call/session.ts.
    const href = telHref(digits)
    if (href) window.location.href = href
  }

  async function handleExtendLock() {
    setExtending(true)
    const result = await claimGroupForCall(eventId, group.id)
    setExtending(false)
    if (result.ok) setLockedUntil(result.group.locked_until)
  }

  async function handleConfirmSubmit() {
    if (!activeAttempt || !outcome) return

    setSaving(true)
    setSubmitError(null)

    const endedAt = new Date()
    const startedMs = new Date(activeAttempt.startedAt).getTime()
    const durationSec = Number.isFinite(startedMs)
      ? Math.max(0, Math.round((endedAt.getTime() - startedMs) / 1000))
      : 0

    const payload: CallCompletionPayload = {
      attemptId: activeAttempt.attemptId,
      eventId,
      eventCode,
      groupId: group.id,
      outcome,
      notes: notes.trim() ? notes.trim() : null,
      callbackAt: outcome === 'callback' && callbackAt ? new Date(callbackAt).toISOString() : null,
      endedAt: endedAt.toISOString(),
      durationSec,
    }

    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false

    if (isOffline) {
      await queueCompletion(payload)
      clearStoredAttempt(group.id)
      setSavedOffline(true)
      setSaving(false)
      setPhase('submitted')
      setQueuedCount((c) => c + 1)
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
      setSaving(false)
      setConfirming(false)
      setSubmitError(result.message)
    } catch {
      // Could not even reach the server — queue it rather than lose the outcome.
      await queueCompletion(payload)
      clearStoredAttempt(group.id)
      setSavedOffline(true)
      setSaving(false)
      setPhase('submitted')
      setQueuedCount((c) => c + 1)
    }
  }

  async function handleRelease() {
    setReleasing(true)
    await releaseGroupAfterCall(eventId, group.id, eventCode)
    router.push(`/${eventCode}/queue`)
  }

  async function handleAbandon() {
    clearStoredAttempt(group.id)
    setReleasing(true)
    await releaseGroupAfterCall(eventId, group.id, eventCode)
    router.push(`/${eventCode}/queue`)
  }

  function handleCallAgain() {
    if (!activeAttempt) return
    setPhase('idle')
    setActiveAttempt(null)
  }

  const rsvpTone = RSVP_TONES[group.rsvp_status] ?? 'neutral'

  return (
    <div className="flex flex-col gap-4">
      <BackRow
        href={`/${eventCode}/queue`}
        title={group.head_name}
        subtitle={[formatMobile(group.primary_mobile), group.city].filter(Boolean).join(' · ')}
        right={
          lockedUntil ? (
            <Badge tone={lockExpired ? 'danger' : lockExpiringSoon ? 'warning' : 'neutral'} size="sm">
              <ClockIcon className="h-3.5 w-3.5" />
              {lockExpired ? 'Lock expired' : lockLabel}
            </Badge>
          ) : null
        }
      />

      <>
        {lockExpiringSoon || lockExpired ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-warning/40 bg-tint-warning px-3.5 py-2.5 text-sm text-warning">
            <span>
              {lockExpired
                ? 'Your 15-minute claim on this family has run out.'
                : `Your claim runs out in ${lockLabel}.`}
            </span>
            <Button
              variant="secondary"
              size="md"
              onClick={handleExtendLock}
              loading={extending}
              className="shrink-0"
            >
              Extend 15m
            </Button>
          </div>
        ) : null}

        {/* Group context */}
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 className="truncate text-lg font-semibold text-fg">{group.head_name}</h2>
              <p className="text-sm text-muted">
                {group.group_type} · {formatPax(group)}
              </p>
            </CardTitle>
            <Badge tone={rsvpTone} size="md">
              {group.rsvp_status.replace('_', ' ')}
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
            primaryDigits={primaryDigits}
            altDigits={altDigits}
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
            confirming={confirming}
            saving={saving}
            error={submitError}
            onOutcomeChange={setOutcome}
            onNotesChange={setNotes}
            onCallbackAtChange={setCallbackAt}
            onReviewSubmit={() => setConfirming(true)}
            onCancelConfirm={() => setConfirming(false)}
            onConfirm={handleConfirmSubmit}
            onAbandon={handleAbandon}
            abandoning={releasing}
          />
        ) : null}

        {phase === 'submitted' ? (
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
              <Button fullWidth variant="primary" onClick={handleRelease} loading={releasing}>
                Release family &amp; back to queue
              </Button>
              <div className="flex w-full gap-2">
                <Button
                  variant="secondary"
                  fullWidth
                  onClick={handleCallAgain}
                  disabled={!primaryDigits && !altDigits}
                >
                  Call again
                </Button>
                <Button variant="ghost" fullWidth onClick={() => router.push(`/${eventCode}/queue`)}>
                  Back without releasing
                </Button>
              </div>
            </CardFooter>
          </Card>
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
                        {format(new Date(attempt.started_at), 'd MMM, HH:mm')}
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
                      {attempt.duration_sec !== null ? ` · ${formatDuration(attempt.duration_sec)}` : ''}
                      {attempt.caller_id === viewerId ? ' · you' : ''}
                    </p>
                    {attempt.notes ? <p className="text-sm text-fg">{attempt.notes}</p> : null}
                    {attempt.callback_at ? (
                      <p className="text-xs text-info">
                        Callback requested: {format(new Date(attempt.callback_at), "d MMM, HH:mm")}
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
          <button
            type="button"
            onClick={handleAbandon}
            disabled={releasing}
            className="tap self-center px-3 py-2 text-sm font-medium text-muted underline-offset-2 hover:text-fg hover:underline disabled:opacity-60"
          >
            Not calling right now — release this family
          </button>
        ) : null}
      </>
    </div>
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
  primaryDigits,
  altDigits,
  starting,
  error,
  onCall,
}: {
  primaryDigits: string | null
  altDigits: string | null
  starting: 'primary' | 'alt' | null
  error: string | null
  onCall: (which: 'primary' | 'alt') => void
}) {
  if (!primaryDigits && !altDigits) {
    return (
      <Card>
        <CardBody>
          <EmptyState
            icon={<PhoneIcon className="h-6 w-6" />}
            title="No phone number on file"
            description="This family has no primary or alternate mobile number recorded. Fix it in the Excel source and re-import before calling."
          />
        </CardBody>
      </Card>
    )
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        {primaryDigits ? (
          <Button
            size="lg"
            fullWidth
            leadingIcon={<PhoneIcon className="h-5 w-5" />}
            loading={starting === 'primary'}
            disabled={starting !== null}
            onClick={() => onCall('primary')}
          >
            Call {formatMobile(primaryDigits)}
          </Button>
        ) : null}

        {altDigits ? (
          <Button
            variant="secondary"
            size="md"
            fullWidth
            leadingIcon={<PhoneIcon className="h-4 w-4" />}
            loading={starting === 'alt'}
            disabled={starting !== null}
            onClick={() => onCall('alt')}
          >
            Call alternate {formatMobile(altDigits)}
          </Button>
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
  confirming,
  saving,
  error,
  onOutcomeChange,
  onNotesChange,
  onCallbackAtChange,
  onReviewSubmit,
  onCancelConfirm,
  onConfirm,
  onAbandon,
  abandoning,
}: {
  activeAttempt: StoredCallAttempt
  outcome: CallOutcome | null
  notes: string
  callbackAt: string
  confirming: boolean
  saving: boolean
  error: string | null
  onOutcomeChange: (value: CallOutcome) => void
  onNotesChange: (value: string) => void
  onCallbackAtChange: (value: string) => void
  onReviewSubmit: () => void
  onCancelConfirm: () => void
  onConfirm: () => void
  onAbandon: () => void
  abandoning: boolean
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
          <Input
            type="datetime-local"
            label="Call back at"
            value={callbackAt}
            onChange={(e) => onCallbackAtChange(e.target.value)}
          />
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
        <Button fullWidth disabled={!outcome} onClick={onReviewSubmit}>
          Save outcome
        </Button>
        <button
          type="button"
          onClick={onAbandon}
          disabled={abandoning}
          className="tap self-center px-3 py-1.5 text-sm font-medium text-muted underline-offset-2 hover:text-fg hover:underline disabled:opacity-60"
        >
          Abandon — release without recording an outcome
        </button>
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

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m === 0) return `${s}s`
  return `${m}m ${s}s`
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
