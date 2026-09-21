'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import {
  AlertTriangleIcon,
  ChevronDownIcon,
  ClockIcon,
  InboxIcon,
  MinusIcon,
  PhoneIcon,
  PlusIcon,
} from '@/components/icons'
import { Badge } from '@/components/ui/Badge'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { Input } from '@/components/ui/Input'
import { LoadingRows } from '@/components/ui/LoadingRows'
import { PageTitle } from '@/components/ui/PageTitle'
import { StatusPill } from '@/components/ui/StatusPill'
import { SyncChip } from '@/components/ui/SyncChip'
import { startCallAttempt, submitCallOutcome } from '@/lib/actions/call'
import { saveRsvpLog } from '@/lib/actions/rsvp'
import {
  clearStoredAttempt,
  getStoredAttempt,
  setStoredAttempt,
  type StoredCallAttempt,
} from '@/lib/call/session'
import { MAX_PLAUSIBLE_CALL_SEC, type CallOutcome, type GuestGroupRow } from '@/lib/call/types'
import { useOptimisticAction } from '@/lib/mutate/useOptimisticAction'
import { dialTarget, placeCall } from '@/lib/native-call'
import { traceFetch } from '@/lib/perf'
import { formatMobile } from '@/lib/phone'
import { queryKeys, type QueueFiltersKey } from '@/lib/query/keys'
import { rsvpStatusLabel } from '@/lib/rsvp'
import {
  EMPTY_LEG,
  type RsvpLogFormValues,
  type SpecialRequirement,
} from '@/lib/rsvp-log'
import { captureDiagnostic } from '@/lib/sentry'
import { createClient } from '@/lib/supabase/client'
import { statusTone } from '@/lib/status'
import { formatDateTime } from '@/lib/utils'

type QueueRow = {
  group_id: string | null
  head_name: string | null
  primary_mobile: string | null
  side: string | null
  expected_pax: number | null
  confirmed_pax: number | null
  rsvp_status: string | null
  priority: number | null
  is_locked: boolean | null
  attempt_count: number | null
  last_outcome: string | null
  next_callback_at: string | null
}

type FamilyRow = Pick<
  GuestGroupRow,
  | 'id'
  | 'head_name'
  | 'primary_mobile'
  | 'expected_pax'
  | 'confirmed_pax'
  | 'adults_confirmed'
  | 'children_confirmed'
  | 'needs_pickup'
  | 'special_requirements'
  | 'rsvp_status'
  | 'side'
>

type RsvpStatus = QueueFiltersKey['statuses'][number]
type Side = NonNullable<QueueFiltersKey['side']>

export interface CallNextProps {
  eventId: string
  eventCode: string
}

// ---------------------------------------------------------------------------
// The read
// ---------------------------------------------------------------------------

/**
 * One read of `v_rsvp_queue`, in the order a caller works it.
 *
 * The ORDER is the one `(staff)/rsvp/next/page.tsx` already uses to decide who
 * is next — never called first, then fewest attempts, then the oldest attempt,
 * then priority — and NOT the v1 queue board's (priority, then name). The v1
 * board is a register you scan; this screen answers a different question
 * ("who do I ring now"), and its head is the family the card shows.
 *
 * `next_callback_at` is computed by the view as
 * `min(callback_at) filter (where callback_at > now())`: server clock, already
 * in the future, so the only correct test is "is there one" — never a
 * comparison against the phone's clock.
 */
async function fetchQueue(
  supabase: ReturnType<typeof createClient>,
  eventId: string,
  filters: QueueFiltersKey,
): Promise<QueueRow[]> {
  let query = supabase.from('v_rsvp_queue').select('*').eq('event_id', eventId)

  if (filters.statuses.length > 0) query = query.in('rsvp_status', [...filters.statuses])
  if (filters.side) query = query.eq('side', filters.side)
  if (filters.callbackScheduled) query = query.not('next_callback_at', 'is', null)
  if (filters.hideLocked) query = query.eq('is_locked', false)

  if (filters.callbackScheduled) {
    query = query.order('next_callback_at', { ascending: true })
  }

  const { data, error } = await traceFetch('call-next :: v_rsvp_queue', () =>
    query
      .order('attempt_count', { ascending: true })
      .order('last_attempt_at', { ascending: true })
      .order('priority', { ascending: false })
      .order('head_name', { ascending: true }),
  )

  if (error) {
    throw new Error('Could not load the calling list. Check your connection and try again.')
  }

  return (data ?? []) as unknown as QueueRow[]
}

/**
 * The family currently on screen, read in full.
 *
 * WHY A SECOND READ. `v_rsvp_queue` does not carry `adults_confirmed`,
 * `children_confirmed`, `needs_pickup` or `special_requirements`, and
 * `save_rsvp_log` sets adults/children UNCONDITIONALLY and writes
 * `needs_pickup` from a boolean — so a one-tap outcome sent from the queue row
 * alone would blank a family's head counts and clear a pickup flag on its way
 * past. Those four columns are read here so the outcome write can hand the
 * database back exactly what it already holds.
 *
 * It is a BACKGROUND read. The card paints from the queue row, which already
 * has the name, the number, the guest count and the status; this one only
 * supplies the fields the write has to preserve and the default head count for
 * the "Coming" sheet, and it lands while the caller is still dialling.
 */
async function fetchFamily(
  supabase: ReturnType<typeof createClient>,
  eventId: string,
  groupId: string,
): Promise<FamilyRow | null> {
  const { data, error } = await supabase
    .from('guest_groups')
    .select(
      'id, head_name, primary_mobile, expected_pax, confirmed_pax, adults_confirmed, children_confirmed, needs_pickup, special_requirements, rsvp_status, side',
    )
    .eq('id', groupId)
    .eq('event_id', eventId)
    .maybeSingle()

  if (error) {
    throw new Error('Could not open that family. Check your connection and try again.')
  }

  return (data ?? null) as unknown as FamilyRow | null
}

// ---------------------------------------------------------------------------
// The five outcomes
// ---------------------------------------------------------------------------

/**
 * The five outcomes the app can actually write. `not_started` is not an
 * outcome and `attempted` is not accepted by `rsvpLogSchema`, so neither is
 * offerable here — the two statuses the v1 form also leaves out.
 */
type OutcomeStatus = 'confirmed' | 'declined' | 'unreachable' | 'callback' | 'tentative'

interface Outcome {
  status: OutcomeStatus
  label: string
  /** What gets written to `call_attempts.outcome` when an attempt is open. */
  callOutcome: CallOutcome
  /**
   * 'count' — the database will not accept this status without a head count
   * (confirmed and tentative both require at least one person: see
   * `rsvpLogSchema`). 'time' — a callback is not a callback without a time.
   */
  needs?: 'count' | 'time'
}

/**
 * THE FIVE, in the words the runner uses.
 *
 * The labels — and the mapping onto `app.rsvp_status` — are the ones the v1
 * outcome form already ships (`RsvpLogForm.tsx`'s `STATUS_LABELS`), not new
 * copy invented here: `unreachable` is "No answer" in that form's own words.
 * There is no `wrong_number` value in `app.rsvp_status`, and a wrong number IS
 * the family being unreachable on that line, so it lands in the same place the
 * v1 form puts it rather than in a status the database does not have.
 *
 * TWO OF THE FIVE OPEN A SHEET RATHER THAN COMMITTING ON THE TAP. An outcome
 * that needs a number the family actually said cannot be sent without one:
 * `rsvpLogSchema` rejects a confirmed/tentative log with no head count, and
 * defaulting it from `expected_pax` would write a guess into `confirmed_pax`
 * that nobody ever confirmed. The sheet is pre-filled from the family's own
 * record, so confirming what is already there is one tap on Save.
 */
const OUTCOMES: Outcome[] = [
  { status: 'confirmed', label: 'Coming', callOutcome: 'connected', needs: 'count' },
  { status: 'declined', label: 'Not coming', callOutcome: 'declined' },
  { status: 'unreachable', label: 'No answer', callOutcome: 'no_answer' },
  { status: 'callback', label: 'Call back', callOutcome: 'callback', needs: 'time' },
  { status: 'tentative', label: 'Maybe', callOutcome: 'connected', needs: 'count' },
]

/** Tone per outcome, applied as plain markup — see the note in the button. */
const OUTCOME_SKIN: Record<OutcomeStatus, string> = {
  confirmed: 'border-ledger-green/45 bg-green-tint text-ledger-green',
  declined: 'border-ledger-red/40 bg-red-tint text-ledger-red',
  unreachable: 'border-ledger-red/40 bg-red-tint text-ledger-red',
  callback: 'border-brand/45 bg-brand-tint text-brand',
  tentative: 'border-rule-strong bg-surface-2 text-ink',
}

// ---------------------------------------------------------------------------
// "Choose who to call" — the filter, behind ONE control
// ---------------------------------------------------------------------------

interface Preset {
  id: string
  label: string
  statuses: RsvpStatus[]
  callbackScheduled?: boolean
  /** Shown under the chip in the sheet, in plain words. */
  hint: string
}

/**
 * THE DEFAULT IS "STILL TO CALL", and it is what makes the screen advance.
 *
 * The card is the head of this list, and after a save the list is re-read from
 * the server — so a family whose outcome was just logged only disappears if the
 * filter excludes the status it was given. With every status in view (the v1
 * board's default) the family that was just called came straight back to the
 * top, which reads as the save having failed.
 *
 * `attempted` is in the default set because nothing in this app writes it —
 * `apply_rsvp_extraction` can — and a family in that state has still not been
 * resolved.
 */
const PRESETS: Preset[] = [
  {
    id: 'todo',
    label: 'Still to call',
    statuses: ['not_started', 'attempted'],
    hint: 'Nobody has got an answer out of these families yet.',
  },
  {
    id: 'callback',
    label: 'Call backs due',
    statuses: [],
    callbackScheduled: true,
    hint: 'Families who asked to be called later, soonest first.',
  },
  {
    id: 'noanswer',
    label: 'No answer',
    statuses: ['unreachable'],
    hint: 'Rang out or the number was wrong. Try again.',
  },
  {
    id: 'maybe',
    label: 'Maybe',
    statuses: ['tentative'],
    hint: 'Not sure yet — worth another call.',
  },
  {
    id: 'everyone',
    label: 'Everyone',
    statuses: [],
    hint: 'The whole list, including families already confirmed or declined.',
  },
]

const SIDES: { value: Side | null; label: string }[] = [
  { value: null, label: 'Both sides' },
  { value: 'bride', label: 'Bride' },
  { value: 'groom', label: 'Groom' },
  { value: 'both', label: 'Both' },
  { value: 'other', label: 'Other' },
]

// ---------------------------------------------------------------------------
// Spreading the team across the list
// ---------------------------------------------------------------------------

/** Deliberately the SAME key the v1 queue board uses (see QueueBoard.tsx). */
const QUEUE_OFFSET_KEY = 'eventflow:queue:offset'

/**
 * A per-phone starting point in the list.
 *
 * THE PROBLEM THIS SOLVES IS NEW TO THIS SCREEN, and it is the reason the v1
 * board has the same trick. Ten callers all working "the next family" would all
 * be shown the SAME family — the head of one shared ordering — so they would
 * ring the same uncle simultaneously and log two different outcomes for him.
 * v1's board only used the offset to decide where the register starts
 * scrolling; here it decides which family is on screen, which makes it
 * load-bearing rather than cosmetic.
 *
 * Random per SESSION, stored in `sessionStorage` so it does not change as the
 * caller walks down the list, and read through a lazy initialiser so it is
 * never touched during a server render. No hydration risk: until the client's
 * own query resolves, both the server and the browser render the skeleton, so
 * the offset cannot change the first paint.
 */
function getOrCreateOffset(): number {
  if (typeof window === 'undefined') return 0
  const stored = sessionStorage.getItem(QUEUE_OFFSET_KEY)
  if (stored !== null) return parseInt(stored, 10) || 0
  const offset = Math.floor(Math.random() * 12) // 0-11, enough to spread ten callers
  sessionStorage.setItem(QUEUE_OFFSET_KEY, String(offset))
  return offset
}

// ---------------------------------------------------------------------------

export function CallNext({ eventId, eventCode }: CallNextProps) {
  const supabase = useMemo(() => createClient(), [])

  const [presetId, setPresetId] = useState('todo')
  const [side, setSide] = useState<Side | null>(null)
  const [hideLocked, setHideLocked] = useState(false)

  const [openSheet, setOpenSheet] = useState<'filter' | 'count' | 'time' | null>(null)
  const [pendingOutcome, setPendingOutcome] = useState<Outcome | null>(null)
  const [adults, setAdults] = useState(1)
  const [children, setChildren] = useState(0)
  const [callbackAt, setCallbackAt] = useState('')

  const [dialError, setDialError] = useState<string | null>(null)
  const [diallingGroupId, setDiallingGroupId] = useState<string | null>(null)

  // The in-flight attempt for the family on screen. sessionStorage is the
  // breadcrumb (see lib/call/session.ts); the ref is the copy this component
  // can read without re-rendering, and it is what the visibility listener
  // stamps `returnedAt` into when the caller comes back from the dialler.
  const attemptRef = useRef<StoredCallAttempt | null>(null)

  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0]

  const filters = useMemo<QueueFiltersKey>(
    () => ({
      statuses: preset.statuses,
      side,
      callbackScheduled: preset.callbackScheduled ?? false,
      hideLocked,
    }),
    [preset, side, hideLocked],
  )

  const queueKey = useMemo(() => queryKeys.rsvp.queue(eventId, filters), [eventId, filters])

  const {
    data: raw,
    isPending,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: queueKey,
    queryFn: () => fetchQueue(supabase, eventId, filters),
  })

  const rows = raw ?? null
  // A row without a group id cannot be called, written to, or named. The view
  // types it as nullable; the filter is what makes the narrowing below sound.
  const callable = useMemo(() => (rows ?? []).filter((r) => r.group_id !== null), [rows])
  // This phone's starting point in the list, so ten callers are not all shown
  // the same family. See `getOrCreateOffset`.
  const [offset] = useState(() => getOrCreateOffset())
  const current = callable.length > 0 ? callable[offset % callable.length] : null
  const currentId = current?.group_id ?? null

  const {
    data: rawFamily,
    error: familyError,
  } = useQuery({
    queryKey: queryKeys.families.detail(eventId, currentId ?? 'none'),
    queryFn: () => fetchFamily(supabase, eventId, currentId as string),
    enabled: currentId !== null,
    // Never serve a cached record for a family that was written to seconds ago.
    // The outcome write patches the QUEUE, not this entry, so a 30s-stale
    // detail row would pre-fill a sheet with head counts that no longer match.
    staleTime: 0,
  })

  const family = (rawFamily ?? null) as FamilyRow | null

  const loadError = error instanceof Error ? error.message : error ? String(error) : null
  const stale = isFetching && rows !== null

  // ------------------------------------------------------------------
  // The write
  // ------------------------------------------------------------------

  const outcome = useOptimisticAction<QueueRow[], OutcomeVars, GuestGroupRow>({
    queryKey: queueKey,
    callSite: 'v2-rsvp-outcome',
    // The family leaves the list on the tap. `settle()` re-reads the same key
    // afterwards, so what the screen shows next is the server's list, not this
    // guess — and with the default filter the family it just logged is
    // genuinely gone from it.
    apply: (prev, v) => (prev ?? []).filter((r) => r.group_id !== v.groupId),
    message: (v) => `${v.headName} · ${v.label}`,
    action: async (v) => {
      // ONE round trip for both records. They are two different tables — the
      // RSVP outcome on `guest_groups` and the call outcome on the frozen
      // `call_attempts` row — and there is no single RPC that writes both, so
      // they go in parallel rather than in sequence (T5: no handler with two
      // awaited calls in a row).
      const [rsvp, call] = await Promise.all([
        saveRsvpLog({
          eventId,
          eventCode,
          groupId: v.groupId,
          values: v.values,
        }),
        v.attempt
          ? submitCallOutcome({
              attemptId: v.attempt.attemptId,
              eventId,
              eventCode,
              groupId: v.groupId,
              outcome: v.callOutcome,
              notes: null,
              callbackAt: v.callbackAt,
              endedAt: new Date().toISOString(),
              durationSec: durationOf(v.attempt),
            })
          : Promise.resolve(null),
      ])

      if (!rsvp.ok) return { ok: false, message: rsvp.message }

      if (call && !call.ok && !call.alreadyFinalized) {
        // The RSVP landed and the call row did not close. The row stays open
        // (it freezes only when `outcome` is set), and the breadcrumb is left
        // in place so the NEXT outcome logged for this family closes it. This
        // is the one failure the screen cannot report: `ok` is about the RSVP,
        // which is saved, and a failure banner here would tell the runner their
        // outcome was lost when it was not. The diagnostic is what leaves the
        // device instead.
        captureDiagnostic('v2-call-next::close-attempt', call.diagnostic, {
          eventId,
          groupId: v.groupId,
        })
      } else {
        clearStoredAttempt(v.groupId)
      }

      return { ok: true, data: rsvp.group }
    },
    // NO UNDO, AND NOT DEFERRED. The RSVP outcome is forward-only evidence and
    // the `call_attempts` row freezes permanently the moment an outcome is
    // written (`app.guard_call_attempt`, CLAUDE.md §5.4) — there is no reverse
    // to send and no window in which "nothing was sent" is still true once the
    // call row is closed. Offering Undo here would be the lie the hook's own
    // header warns about, so the write commits and the screen moves on.
    queue: { eventId, kind: 'v2-rsvp-outcome', what: 'call outcome' },
  })

  const writeError = outcome.lastError

  // ------------------------------------------------------------------
  // Dialling
  // ------------------------------------------------------------------

  // The moment the caller comes back from the dialler is the end of the call.
  // Android destroys this page while the dialler is open, so this listener is
  // for the trips where it did not.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState !== 'visible') return
      const attempt = attemptRef.current
      if (!attempt || attempt.dialedAt === undefined || attempt.returnedAt !== undefined) return
      const next: StoredCallAttempt = { ...attempt, returnedAt: Date.now() }
      attemptRef.current = next
      setStoredAttempt(next)
    }

    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  /**
   * The dial. `call_attempts` is written BEFORE `tel:` fires and never after —
   * `tel:` backgrounds the WebView and Android may discard all page state, so
   * this is the only guaranteed moment at which the call can be recorded
   * (CLAUDE.md §12). A dial that could not be logged does not happen: a call
   * that is not logged is a call that never happened, and the number stays in
   * the card for another attempt.
   */
  async function handleCall(row: QueueRow) {
    const groupId = row.group_id
    if (!groupId || diallingGroupId !== null) return

    const target = dialTarget(row.primary_mobile)
    if (!target) {
      setDialError('No phone number on file for this family. Pick another family, or ask your lead for the number.')
      return
    }

    setDialError(null)
    setDiallingGroupId(groupId)

    let result: Awaited<ReturnType<typeof startCallAttempt>>
    try {
      result = await startCallAttempt({
        eventId,
        groupId,
        dialedNumber: target.dialedNumber,
        deviceStartedAt: new Date().toISOString(),
      })
    } catch {
      setDiallingGroupId(null)
      setDialError(
        'No connection, so this call could not be logged — and a call that is not logged is a call that never happened. Move to where there is signal and try again.',
      )
      return
    }

    if (!result.ok) {
      setDiallingGroupId(null)
      setDialError(result.message)
      captureDiagnostic('v2-call-next::startCallAttempt', result.diagnostic, { eventId, groupId })
      return
    }

    const entry: StoredCallAttempt = {
      attemptId: result.attempt.id,
      groupId,
      eventId,
      dialedNumber: target.dialedNumber,
      startedAt: result.attempt.started_at,
      dialedAt: Date.now(),
    }
    attemptRef.current = entry
    setStoredAttempt(entry)
    setDiallingGroupId(null)

    await placeCall(target)
  }

  // ------------------------------------------------------------------
  // Logging an outcome
  // ------------------------------------------------------------------

  function openOutcome(row: QueueRow, choice: Outcome) {
    if (choice.needs === 'count') {
      const nextAdults = family?.adults_confirmed ?? family?.expected_pax ?? 1
      setAdults(Math.max(nextAdults, 1))
      setChildren(family?.children_confirmed ?? 0)
      setPendingOutcome(choice)
      setOpenSheet('count')
      return
    }
    if (choice.needs === 'time') {
      setCallbackAt(roundUpToNextHour())
      setPendingOutcome(choice)
      setOpenSheet('time')
      return
    }
    logOutcome(row, choice, {})
  }

  function logOutcome(
    row: QueueRow,
    choice: Outcome,
    counts: { adults?: number; children?: number; callbackAt?: string },
  ) {
    const groupId = row.group_id
    if (!groupId) return

    const stored = attemptRef.current ?? getStoredAttempt(groupId)
    const attempt = stored && stored.groupId === groupId ? stored : null

    outcome.run({
      groupId,
      headName: displayName(row),
      label: choice.label,
      callOutcome: choice.callOutcome,
      callbackAt: choice.status === 'callback' ? (counts.callbackAt ?? null) : null,
      attempt,
      values: {
        rsvpStatus: choice.status,
        adultsConfirmed: stringCount(counts.adults ?? family?.adults_confirmed),
        childrenConfirmed: stringCount(counts.children ?? family?.children_confirmed),
        // Preserved from the family's own record. `save_rsvp_log` overwrites
        // `needs_pickup` with whatever boolean arrives, so the current value is
        // handed straight back rather than defaulting to false.
        needsPickup: family?.needs_pickup ?? false,
        specialRequirements: (family?.special_requirements ?? []) as SpecialRequirement[],
        callbackDatetime: counts.callbackAt ?? '',
        // Blank notes and blank legs mean "leave the existing value alone" —
        // the RPC coalesces remarks and only upserts a leg given an object.
        notes: '',
        arrival: { ...EMPTY_LEG },
        departure: { ...EMPTY_LEG },
      },
    })

    setOpenSheet(null)
    setPendingOutcome(null)
  }

  // ------------------------------------------------------------------

  if (loadError && rows === null) {
    return (
      <div className="flex flex-col gap-4">
        <PageTitle>Call the next family</PageTitle>
        <ErrorState title={loadError} onRetry={() => void refetch()} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <PageTitle className="min-w-0 flex-1">Call the next family</PageTitle>
        {/* ONE control, in the title row rather than as a strip above the work.
            Every filter this screen has lives inside it — the v1 board put a
            progress bar, four status chips, a side dropdown and two toggles in
            front of the first family. */}
        <button
          type="button"
          onClick={() => setOpenSheet('filter')}
          className="tap inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl border border-rule-strong bg-surface px-3 text-sm font-medium text-ink active:bg-surface-2"
        >
          {preset.label}
          <ChevronDownIcon className="h-4 w-4 text-muted" aria-hidden />
        </button>
      </div>

      {stale ? (
        <p role="status" className="-mt-1 text-xs text-muted">
          Updating…
        </p>
      ) : null}

      {writeError ? (
        <p
          role="alert"
          className="rounded-xl border border-ledger-red/40 bg-red-tint px-3.5 py-3 text-sm font-medium text-ledger-red"
        >
          {writeError}
        </p>
      ) : null}

      {/* R8/T7: a write that could not reach the server is saved on this phone
          and never reported as saved. `SyncChip` is the only offline surface
          here, and it carries no `onPress` on purpose — the only existing usage
          in the app (the design-system page) is the same, and the queue drains
          itself on reconnect and on returning to the app, so a tap that
          silently re-tried would be a control with nothing behind it. */}
      <SyncChip count={outcome.queuedCount} what="call outcome" />

      {isPending ? (
        <LoadingRows count={3} />
      ) : rows === null ? null : current === null ? (
        <EmptyState
          icon={<InboxIcon className="h-7 w-7" />}
          title={preset.id === 'todo' ? "That's everyone" : 'Nothing in this list'}
          description={
            preset.id === 'todo'
              ? 'Every family in this list has been called. Families already logged are still there under “Everyone”.'
              : 'No family matches this view. Pick another list, or check with your lead if you expected families here.'
          }
          action={
            <Button variant="secondary" fullWidth onClick={() => setOpenSheet('filter')}>
              Choose who to call
            </Button>
          }
        />
      ) : (
        <>
          <FamilyCard
            row={current}
            dialling={diallingGroupId === current.group_id}
            onCall={() => void handleCall(current)}
          />

          {familyError ? (
            <p className="flex items-start gap-2 rounded-xl border border-rule-strong bg-surface px-3.5 py-3 text-sm text-muted">
              <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-ledger-red" aria-hidden />
              <span>
                This family&rsquo;s saved numbers could not be read, so logging an outcome is held
                until they load — reload the screen.
              </span>
            </p>
          ) : null}

          {/* The dial, then what happened under it. */}
          <section className="flex flex-col gap-2.5">
            <h3 className="eyebrow">What happened on the call?</h3>

            {family === null && !familyError ? (
              <LoadingRows count={2} />
            ) : (
              <div className="grid grid-cols-2 gap-2.5" role="group" aria-label="Log the outcome">
                {OUTCOMES.map((choice) => (
                  <button
                    key={choice.status}
                    type="button"
                    onClick={() => openOutcome(current, choice)}
                    disabled={family === null}
                    /* Plain markup with the app's own tokens, NOT `Chip`.
                       `cn()` concatenates and does not resolve Tailwind
                       conflicts, so a `bg-green-tint text-ledger-green` passed
                       through `className` sits BESIDE the chip's own
                       `bg-surface text-muted` and which one paints is decided
                       by stylesheet order, not by the caller. The five
                       outcomes have to read differently at a glance (emerald
                       for coming, signal for a gap — globals.css), so the
                       colour is written here and not fought for. */
                    className={`tap flex min-h-14 w-full items-center justify-center rounded-xl border px-3 text-base font-semibold transition-colors duration-press ease-ledger active:opacity-80 disabled:opacity-55 ${
                      choice.status === 'confirmed'
                        ? 'col-span-2 border-transparent bg-brand text-brand-fg shadow-e1'
                        : OUTCOME_SKIN[choice.status]
                    }`}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
            )}
          </section>

          {dialError ? (
            <p
              role="alert"
              className="rounded-xl border border-ledger-red/40 bg-red-tint px-3.5 py-3 text-sm font-medium text-ledger-red"
            >
              {dialError}
            </p>
          ) : null}
        </>
      )}

      {/* ------------------------------------------------------------------
          Sheets
          ------------------------------------------------------------------ */}

      <BottomSheet
        open={openSheet === 'filter'}
        onClose={() => setOpenSheet(null)}
        label="Choose who to call"
      >
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-ink">Choose who to call</h2>

          <div className="flex flex-wrap gap-2" role="group" aria-label="Which families">
            {PRESETS.map((p) => (
              <Chip
                key={p.id}
                selected={p.id === presetId}
                onClick={() => setPresetId(p.id)}
                className="w-full"
              >
                {p.label}
              </Chip>
            ))}
          </div>
          <p className="-mt-2 text-sm leading-snug text-muted">
            {preset.hint}
          </p>

          <div className="flex flex-col gap-2">
            <h3 className="eyebrow">Which side</h3>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Which side">
              {SIDES.map((s) => (
                <Chip key={s.label} selected={s.value === side} onClick={() => setSide(s.value)}>
                  {s.label}
                </Chip>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="eyebrow">Open on another phone</h3>
            <Chip
              selected={hideLocked}
              onClick={() => setHideLocked((v) => !v)}
              className="w-full"
            >
              Skip families another caller has open
            </Chip>
            <p className="text-sm leading-snug text-muted">
              A family another caller has open cannot be logged until their lock clears.
            </p>
          </div>

          <Button size="lg" fullWidth onClick={() => setOpenSheet(null)}>
            Done
          </Button>
        </div>
      </BottomSheet>

      <BottomSheet
        open={openSheet === 'count'}
        onClose={() => setOpenSheet(null)}
        label="How many guests are coming?"
      >
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-ink">
            {pendingOutcome?.status === 'tentative'
              ? 'How many guests might come?'
              : 'How many guests are coming?'}
          </h2>
          <p className="-mt-2 text-sm leading-snug text-muted">
            {displayNameOf(current)} · counted on the phone, not guessed from the sheet.
          </p>

          <Stepper label="Adults" value={adults} onChange={setAdults} />
          <Stepper label="Children" value={children} onChange={setChildren} />

          <p className="figure text-sm text-muted">
            {adults + children} {adults + children === 1 ? 'guest' : 'guests'} in total
          </p>

          <Button
            size="lg"
            fullWidth
            disabled={adults + children < 1}
            onClick={() => {
              if (current && pendingOutcome) {
                logOutcome(current, pendingOutcome, { adults, children })
              }
            }}
          >
            Save — {pendingOutcome?.label ?? 'log it'}
          </Button>
          {adults + children < 1 ? (
            <p className="-mt-2 text-sm text-muted">
              Add at least one guest — a family of nobody is not an answer.
            </p>
          ) : null}
        </div>
      </BottomSheet>

      <BottomSheet
        open={openSheet === 'time'}
        onClose={() => setOpenSheet(null)}
        label="When should we call back?"
      >
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-ink">When should we call back?</h2>
          <p className="-mt-2 text-sm leading-snug text-muted">
            Without a time this family drops out of the callback list.
          </p>

          <Input
            type="datetime-local"
            label="Call back at"
            value={callbackAt}
            onChange={(e) => setCallbackAt(e.target.value)}
          />

          <Button
            size="lg"
            fullWidth
            disabled={callbackAt === ''}
            onClick={() => {
              if (current && pendingOutcome) {
                logOutcome(current, pendingOutcome, {
                  callbackAt: callbackAt === '' ? undefined : new Date(callbackAt).toISOString(),
                })
              }
            }}
          >
            Save — {pendingOutcome?.label ?? 'log it'}
          </Button>
        </div>
      </BottomSheet>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/**
 * The one family on screen.
 *
 * Name, number, how many guests, then the 56px dial button — in that order,
 * because a caller reading this is about to say a name out loud.
 */
function FamilyCard({
  row,
  dialling,
  onCall,
}: {
  row: QueueRow
  dialling: boolean
  onCall: () => void
}) {
  const name = displayName(row)
  const mobile = row.primary_mobile?.trim() || null
  const guests = row.confirmed_pax ?? row.expected_pax ?? 0
  const status = row.rsvp_status ?? 'not_started'
  const attempts = row.attempt_count ?? 0
  const callback = row.next_callback_at
  const locked = row.is_locked === true
  const canDial = dialTarget(mobile) !== null

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-rule-strong bg-surface p-4 shadow-e1">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl leading-tight font-semibold text-ink">{name}</h2>
          {mobile ? (
            <p className="figure mt-1 text-base text-muted">{formatMobile(mobile)}</p>
          ) : (
            <p className="mt-1 text-base text-muted">No number on file</p>
          )}
        </div>
        <StatusPill tone={statusTone(status)}>{rsvpStatusLabel(status)}</StatusPill>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="figure text-ink">
          {guests} {guests === 1 ? 'guest' : 'guests'}
        </span>
        {row.side ? <Badge>{row.side}</Badge> : null}
        <span className="figure text-muted">
          · {attempts} {attempts === 1 ? 'attempt' : 'attempts'}
        </span>
      </div>

      {callback ? (
        <p className="flex items-center gap-1.5 text-sm font-medium text-brand">
          <ClockIcon className="h-4 w-4 shrink-0" aria-hidden />
          Asked to be called back {formatDateTime(callback)}
        </p>
      ) : null}

      {locked ? (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">
          Another caller has this family open. Logging it may be refused until their lock clears.
        </p>
      ) : null}

      <Button
        size="lg"
        fullWidth
        disabled={!canDial}
        leadingIcon={<PhoneIcon className="h-5 w-5" aria-hidden />}
        onClick={onCall}
      >
        {dialling ? 'Logging the call…' : `Call ${firstName(name)}`}
      </Button>
      {!canDial ? (
        <p className="-mt-1.5 text-sm text-muted">
          There is no number to dial. Use the “Choose who to call” control for another family.
        </p>
      ) : null}
    </section>
  )
}

/** A − / + counter, 48px a side, for a number that must be said out loud. */
function Stepper({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (next: number) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-base font-medium text-ink">{label}</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label={`One fewer ${label.toLowerCase()}`}
          onClick={() => onChange(Math.max(0, value - 1))}
          className="tap flex h-12 w-12 items-center justify-center rounded-xl border border-rule-strong bg-surface text-ink active:bg-surface-2"
        >
          <MinusIcon className="h-5 w-5" />
        </button>
        <span className="figure w-12 text-center text-xl font-medium text-ink">{value}</span>
        <button
          type="button"
          aria-label={`One more ${label.toLowerCase()}`}
          onClick={() => onChange(value + 1)}
          className="tap flex h-12 w-12 items-center justify-center rounded-xl border border-rule-strong bg-surface text-ink active:bg-surface-2"
        >
          <PlusIcon className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface OutcomeVars {
  groupId: string
  headName: string
  label: string
  callOutcome: CallOutcome
  callbackAt: string | null
  attempt: StoredCallAttempt | null
  values: RsvpLogFormValues
}

/**
 * A person's name first, never an id. The queue view can return an empty head
 * name, and the fallback is the number it can still be dialled on rather than
 * the group uuid the v1 board printed as "A0-VERIFY-mshqvcsx".
 */
function displayName(row: QueueRow | null): string {
  const name = row?.head_name?.trim()
  if (name) return name
  return 'Unnamed family'
}

function displayNameOf(row: QueueRow | null): string {
  return displayName(row)
}

function firstName(name: string): string {
  const first = name.split(/\s+/)[0]
  return first && first !== 'Unnamed' ? first : 'family'
}

function stringCount(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value)
}

function durationOf(attempt: StoredCallAttempt): number | null {
  if (attempt.dialedAt === undefined || attempt.returnedAt === undefined) return null
  const seconds = Math.round((attempt.returnedAt - attempt.dialedAt) / 1000)
  return seconds >= 0 && seconds <= MAX_PLAUSIBLE_CALL_SEC ? seconds : null
}

/** The next whole hour, as `datetime-local` wants it: "2026-09-23T11:00". */
function roundUpToNextHour(): string {
  const next = new Date()
  next.setHours(next.getHours() + 1, 0, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}T${pad(next.getHours())}:00`
}

export default CallNext
