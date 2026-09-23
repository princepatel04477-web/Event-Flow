'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { AlertTriangleIcon, InboxIcon } from '@/components/icons'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { LoadingRows } from '@/components/ui/LoadingRows'
import { PageTitle } from '@/components/ui/PageTitle'
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
import { lockNote, useStaffNames } from '@/lib/lock'
import { useOptimisticAction } from '@/lib/mutate/useOptimisticAction'
import { dialTarget, placeCall } from '@/lib/native-call'
import { traceFetch } from '@/lib/perf'
import { queryKeys, type QueueFiltersKey } from '@/lib/query/keys'
import {
  EMPTY_LEG,
  type RsvpLogFormValues,
  type SpecialRequirement,
} from '@/lib/rsvp-log'
import { captureDiagnostic } from '@/lib/sentry'
import { createClient } from '@/lib/supabase/client'

import { AppHint } from '../../_components/AppHint'
import { AdminCampaignsLink } from './AdminCampaignsLink'
import { CallbackCaptureStep } from './CallbackCaptureStep'
import { CurrentFamilyCard } from './CurrentFamilyCard'
import { FamilyQueueList } from './FamilyQueueList'
import { InlineCaptureStep } from './InlineCaptureStep'
import { OutcomeButtons } from './OutcomeButtons'
import { ProgressAndFilters } from './ProgressAndFilters'
import type { CallNextProps, FamilyRow, FilterChipId, OutcomeStatus, QueueRow } from './types'

const QUEUE_OFFSET_KEY = 'eventflow:queue:offset'

function getOrCreateOffset(): number {
  if (typeof window === 'undefined') return 0
  const stored = sessionStorage.getItem(QUEUE_OFFSET_KEY)
  if (stored !== null) return parseInt(stored, 10) || 0
  const offset = Math.floor(Math.random() * 12)
  sessionStorage.setItem(QUEUE_OFFSET_KEY, String(offset))
  return offset
}

async function fetchQueue(
  supabase: ReturnType<typeof createClient>,
  eventId: string,
): Promise<QueueRow[]> {
  const query = supabase
    .from('v_rsvp_queue')
    .select('*')
    .eq('event_id', eventId)
    .order('attempt_count', { ascending: true })
    .order('last_attempt_at', { ascending: true })
    .order('priority', { ascending: false })
    .order('head_name', { ascending: true })

  const { data, error } = await traceFetch('call-next :: v_rsvp_queue', () => query)

  if (error) {
    throw new Error('Could not load the calling list. Check your connection and try again.')
  }

  return (data ?? []) as unknown as QueueRow[]
}

async function fetchFamily(
  supabase: ReturnType<typeof createClient>,
  eventId: string,
  groupId: string,
): Promise<FamilyRow | null> {
  const { data, error } = await supabase
    .from('guest_groups')
    .select(
      'id, head_name, primary_mobile, expected_pax, confirmed_pax, adults_confirmed, children_confirmed, needs_pickup, special_requirements, rsvp_status, group_type, side, remarks',
    )
    .eq('id', groupId)
    .eq('event_id', eventId)
    .maybeSingle()

  if (error) {
    throw new Error('Could not open that family. Check your connection and try again.')
  }

  return (data ?? null) as unknown as FamilyRow | null
}

interface OutcomeVars {
  groupId: string
  headName: string
  label: string
  callOutcome: CallOutcome
  callbackAt: string | null
  attempt: StoredCallAttempt | null
  values: RsvpLogFormValues
}

export function CallNext({ eventId, eventCode, startsOn, endsOn, isAdmin }: CallNextProps) {
  const supabase = useMemo(() => createClient(), [])

  // Filter state per SPEC §B: To call | Call back | Coming | Not coming | All
  const [activeFilter, setActiveFilter] = useState<FilterChipId>('to_call')

  // Selected family override (tapping row in list below)
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)

  // Active inline capture expansion ('confirmed' | 'tentative' | 'callback' | null)
  const [activeInlineOutcome, setActiveInlineOutcome] = useState<OutcomeStatus | null>(null)

  const [dialError, setDialError] = useState<string | null>(null)
  const [diallingGroupId, setDiallingGroupId] = useState<string | null>(null)

  const attemptRef = useRef<StoredCallAttempt | null>(null)

  const filters = useMemo<QueueFiltersKey>(
    () => ({
      statuses: [],
      side: null,
      callbackScheduled: false,
      hideLocked: false,
    }),
    [],
  )

  // Query all queue rows for the event
  const queueKey = useMemo(() => queryKeys.rsvp.queue(eventId, filters), [eventId, filters])

  const {
    data: rawRows,
    isPending,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: queueKey,
    queryFn: () => fetchQueue(supabase, eventId),
  })

  const allRows = useMemo(() => rawRows ?? [], [rawRows])

  // Progress stats computed from all rows
  const totalCount = allRows.length
  const calledCount = allRows.filter(
    (r) =>
      (r.rsvp_status && r.rsvp_status !== 'not_started') ||
      (r.attempt_count !== null && r.attempt_count > 0),
  ).length
  const comingCount = allRows.filter((r) => r.rsvp_status === 'confirmed').length
  const callbackCount = allRows.filter(
    (r) => r.rsvp_status === 'callback' || r.next_callback_at !== null,
  ).length

  // Filter rows based on active filter chip
  const filteredRows = useMemo(() => {
    switch (activeFilter) {
      case 'to_call':
        return allRows.filter(
          (r) => !r.rsvp_status || r.rsvp_status === 'not_started' || r.rsvp_status === 'attempted',
        )
      case 'callback':
        return allRows.filter(
          (r) => r.rsvp_status === 'callback' || r.next_callback_at !== null,
        )
      case 'coming':
        return allRows.filter(
          (r) => r.rsvp_status === 'confirmed' || r.rsvp_status === 'tentative',
        )
      case 'not_coming':
        return allRows.filter(
          (r) => r.rsvp_status === 'declined' || r.rsvp_status === 'unreachable',
        )
      case 'all':
      default:
        return allRows
    }
  }, [allRows, activeFilter])

  const callable = useMemo(() => filteredRows.filter((r) => r.group_id !== null), [filteredRows])

  // Offset per session to distribute staff across the list
  const [offset] = useState(() => getOrCreateOffset())

  // Current family determination: selected row wins, else offset/first
  const current = useMemo<QueueRow | null>(() => {
    if (callable.length === 0) return null
    if (selectedGroupId) {
      const found = callable.find((r) => r.group_id === selectedGroupId)
      if (found) return found
    }
    return callable[offset % callable.length] ?? callable[0] ?? null
  }, [callable, selectedGroupId, offset])

  const currentId = current?.group_id ?? null

  // Fetch full details for the current family
  const { data: rawFamily, error: familyError } = useQuery({
    queryKey: queryKeys.families.detail(eventId, currentId ?? 'none'),
    queryFn: () => fetchFamily(supabase, eventId, currentId as string),
    enabled: currentId !== null,
    staleTime: 0,
  })

  const family = (rawFamily ?? null) as FamilyRow | null

  // Caller lock state
  const staffNames = useStaffNames(eventId)
  const currentLock = useMemo(
    () =>
      current
        ? lockNote(
            {
              isLocked: current.is_locked,
              lockedUntil: current.locked_until,
              lockedByStaff: current.locked_by_staff,
            },
            staffNames,
          )
        : null,
    [current, staffNames],
  )

  const loadError = error instanceof Error ? error.message : error ? String(error) : null
  const isStale = isFetching && rawRows !== undefined
  const lockedAhead = useMemo(
    () => callable.filter((r) => r.is_locked === true).length,
    [callable],
  )

  // Optimistic action for logging outcomes
  const outcome = useOptimisticAction<QueueRow[], OutcomeVars, GuestGroupRow>({
    queryKey: queueKey,
    callSite: 'v2-rsvp-outcome',
    apply: (prev, v) => {
      // Optimistically update the row in the queue cache
      return (prev ?? []).map((r) => {
        if (r.group_id !== v.groupId) return r
        return {
          ...r,
          rsvp_status: v.values.rsvpStatus,
          attempt_count: (r.attempt_count ?? 0) + 1,
          confirmed_pax:
            v.values.adultsConfirmed || v.values.childrenConfirmed
              ? Number(v.values.adultsConfirmed || 0) + Number(v.values.childrenConfirmed || 0)
              : r.confirmed_pax,
          next_callback_at: v.callbackAt,
        }
      })
    },
    message: (v) => `${v.headName} · ${v.label}`,
    action: async (v) => {
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
              notes: v.values.notes || null,
              callbackAt: v.callbackAt,
              endedAt: new Date().toISOString(),
              durationSec: durationOf(v.attempt),
            })
          : Promise.resolve(null),
      ])

      if (!rsvp.ok) return { ok: false, message: rsvp.message }

      if (call && !call.ok && !call.alreadyFinalized) {
        captureDiagnostic('v2-call-next::close-attempt', call.diagnostic, {
          eventId,
          groupId: v.groupId,
        })
      } else {
        clearStoredAttempt(v.groupId)
      }

      return { ok: true, data: rsvp.group }
    },
    queue: { eventId, kind: 'v2-rsvp-outcome', what: 'call outcome' },
  })

  const writeError = outcome.lastError

  // Dialler visibility listener
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

  // Handle dial
  async function handleCall(row: QueueRow) {
    const groupId = row.group_id
    if (!groupId || diallingGroupId !== null) return

    const target = dialTarget(row.primary_mobile)
    if (!target) {
      setDialError('No phone number on file for this family.')
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
      setDialError('No connection, so call could not be logged. Move to signal and retry.')
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

  // Handle outcome selection
  function handleSelectOutcome(choice: OutcomeStatus) {
    if (choice === 'confirmed' || choice === 'tentative') {
      // Toggle or set inline capture step
      setActiveInlineOutcome((prev) => (prev === choice ? null : choice))
      return
    }

    if (choice === 'callback') {
      setActiveInlineOutcome((prev) => (prev === 'callback' ? null : 'callback'))
      return
    }

    // Terminal choices: 'unreachable' (No answer) and 'declined' (Not coming)
    // One-tap instant log and auto-advance per SPEC §B
    if (current) {
      logOutcomeDirectly(current, choice)
    }
  }

  function logOutcomeDirectly(row: QueueRow, status: 'unreachable' | 'declined') {
    const groupId = row.group_id
    if (!groupId) return

    const stored = attemptRef.current ?? getStoredAttempt(groupId)
    const attempt = stored && stored.groupId === groupId ? stored : null
    const callOutcome: CallOutcome = status === 'unreachable' ? 'no_answer' : 'declined'
    const label = status === 'unreachable' ? 'No answer' : 'Not coming'

    outcome.run({
      groupId,
      headName: row.head_name?.trim() || 'family',
      label,
      callOutcome,
      callbackAt: null,
      attempt,
      values: {
        rsvpStatus: status,
        adultsConfirmed: '',
        childrenConfirmed: '',
        needsPickup: family?.needs_pickup ?? false,
        specialRequirements: (family?.special_requirements ?? []) as SpecialRequirement[],
        callbackDatetime: '',
        notes: '',
        arrival: { ...EMPTY_LEG },
        departure: { ...EMPTY_LEG },
      },
    })

    // Auto-advance
    advanceToNextFamily(groupId)
  }

  // Save from InlineCaptureStep (Coming / Maybe)
  function handleSaveInline(values: RsvpLogFormValues) {
    if (!current?.group_id) return
    const groupId = current.group_id

    const stored = attemptRef.current ?? getStoredAttempt(groupId)
    const attempt = stored && stored.groupId === groupId ? stored : null
    const label = values.rsvpStatus === 'confirmed' ? 'Coming' : 'Maybe'

    outcome.run({
      groupId,
      headName: current.head_name?.trim() || 'family',
      label,
      callOutcome: 'connected',
      callbackAt: null,
      attempt,
      values,
    })

    advanceToNextFamily(groupId)
  }

  // Save from CallbackCaptureStep
  function handleSaveCallback(callbackDatetime: string) {
    if (!current?.group_id) return
    const groupId = current.group_id

    const stored = attemptRef.current ?? getStoredAttempt(groupId)
    const attempt = stored && stored.groupId === groupId ? stored : null

    outcome.run({
      groupId,
      headName: current.head_name?.trim() || 'family',
      label: 'Call back',
      callOutcome: 'callback',
      callbackAt: new Date(callbackDatetime).toISOString(),
      attempt,
      values: {
        rsvpStatus: 'callback',
        adultsConfirmed: '',
        childrenConfirmed: '',
        needsPickup: family?.needs_pickup ?? false,
        specialRequirements: (family?.special_requirements ?? []) as SpecialRequirement[],
        callbackDatetime,
        notes: '',
        arrival: { ...EMPTY_LEG },
        departure: { ...EMPTY_LEG },
      },
    })

    advanceToNextFamily(groupId)
  }

  // Auto-advance helper: moves to next family in callable list and closes inline forms
  function advanceToNextFamily(savedGroupId: string) {
    setActiveInlineOutcome(null)

    // Find next family in callable list
    const currentIndex = callable.findIndex((r) => r.group_id === savedGroupId)
    if (currentIndex !== -1 && currentIndex + 1 < callable.length) {
      const nextGroup = callable[currentIndex + 1]
      setSelectedGroupId(nextGroup.group_id)
    } else if (callable.length > 1) {
      const firstOther = callable.find((r) => r.group_id !== savedGroupId)
      setSelectedGroupId(firstOther?.group_id ?? null)
    } else {
      setSelectedGroupId(null)
    }
  }

  if (loadError && !rawRows) {
    return (
      <div className="flex flex-col gap-4">
        <PageTitle>Call the next family</PageTitle>
        <ErrorState title={loadError} onRetry={() => void refetch()} />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 pb-20">
      {/* Top Header Row with Title and Admin Link */}
      <div className="flex items-start justify-between gap-3">
        <PageTitle className="min-w-0 flex-1">Call the next family</PageTitle>
        {/* Admin link for auto-call rounds moved off the caller's path per SPEC §B */}
        <AdminCampaignsLink eventCode={eventCode} isAdmin={isAdmin} />
      </div>

      {isStale ? (
        <p role="status" className="-mt-2 text-xs text-muted">
          Updating queue…
        </p>
      ) : null}

      {/* Progress line & filter chips per SPEC §B */}
      <ProgressAndFilters
        totalCount={totalCount}
        calledCount={calledCount}
        comingCount={comingCount}
        callbackCount={callbackCount}
        activeFilter={activeFilter}
        onFilterChange={(f) => {
          setActiveFilter(f)
          setActiveInlineOutcome(null)
          setSelectedGroupId(null)
        }}
      />

      <AppHint screen="rsvp-queue">Tap a family below to switch to them</AppHint>

      {writeError ? (
        <p
          role="alert"
          className="rounded-xl border border-ledger-red/40 bg-red-tint px-3.5 py-3 text-sm font-medium text-ledger-red"
        >
          {writeError}
        </p>
      ) : null}

      <SyncChip count={outcome.queuedCount} what="call outcome" />

      {isPending ? (
        <LoadingRows count={3} />
      ) : callable.length === 0 || current === null ? (
        <EmptyState
          icon={<InboxIcon className="h-7 w-7" />}
          title={activeFilter === 'to_call' ? "That's everyone!" : 'No families in this filter'}
          description={
            activeFilter === 'to_call'
              ? 'Every family in this queue has been called. View other families with the chips above.'
              : 'No families match this filter right now.'
          }
          action={
            <Button variant="secondary" fullWidth onClick={() => setActiveFilter('all')}>
              View all families
            </Button>
          }
        />
      ) : (
        <>
          {/* Current Family Card per SPEC §B */}
          <CurrentFamilyCard
            row={current}
            dialling={diallingGroupId === current.group_id}
            lock={currentLock}
            onCall={() => void handleCall(current)}
          />

          {familyError ? (
            <p className="flex items-start gap-2 rounded-xl border border-rule-strong bg-surface px-3.5 py-3 text-sm text-muted">
              <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-ledger-red" aria-hidden />
              <span>Could not read saved details. Reconnecting…</span>
            </p>
          ) : null}

          {/* Neutral Segmented Outcome Buttons per SPEC §B */}
          <OutcomeButtons
            activeOutcome={activeInlineOutcome}
            onSelectOutcome={handleSelectOutcome}
            disabled={family === null && !familyError}
          />

          {/* Inline Capture Step for Coming / Maybe */}
          {activeInlineOutcome === 'confirmed' || activeInlineOutcome === 'tentative' ? (
            <InlineCaptureStep
              status={activeInlineOutcome}
              family={family}
              expectedPax={current.expected_pax ?? current.confirmed_pax ?? 1}
              startsOn={startsOn}
              endsOn={endsOn}
              onSave={handleSaveInline}
              onCancel={() => setActiveInlineOutcome(null)}
              isSaving={outcome.syncState === 'sending'}
            />
          ) : null}

          {/* Inline Capture Step for Call back */}
          {activeInlineOutcome === 'callback' ? (
            <CallbackCaptureStep
              onSave={handleSaveCallback}
              onCancel={() => setActiveInlineOutcome(null)}
              isSaving={outcome.syncState === 'sending'}
            />
          ) : null}

          {dialError ? (
            <p
              role="alert"
              className="rounded-xl border border-ledger-red/40 bg-red-tint px-3.5 py-3 text-sm font-medium text-ledger-red"
            >
              {dialError}
            </p>
          ) : null}

          {/* Family List Below: compact rows, tapping makes it current, not hidden by tabs */}
          <FamilyQueueList
            rows={callable}
            currentGroupId={currentId}
            onSelectFamily={(gid) => {
              setSelectedGroupId(gid)
              setActiveInlineOutcome(null)
            }}
            lockedCount={lockedAhead}
          />
        </>
      )}
    </div>
  )
}

function durationOf(attempt: StoredCallAttempt): number | null {
  if (attempt.dialedAt === undefined || attempt.returnedAt === undefined) return null
  const seconds = Math.round((attempt.returnedAt - attempt.dialedAt) / 1000)
  return seconds >= 0 && seconds <= MAX_PLAUSIBLE_CALL_SEC ? seconds : null
}

export default CallNext
