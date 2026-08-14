'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { UploadIcon, InboxIcon } from '@/components/icons'
import { Button } from '@/components/ui/Button'
import { staggerDelay } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { LoadingRows } from '@/components/ui/LoadingRows'
import { PageTitle } from '@/components/ui/PageTitle'
import { createClient } from '@/lib/supabase/client'
import { traceFetch } from '@/lib/perf'
import { QueueFilters } from './QueueFilters'
import { QueueRow, type QueueGroupRow } from './QueueRow'
import {
  DEFAULT_FILTERS,
  filtersToSearchParams,
  hasActiveFilters,
  parseFilters,
  type QueueFilterState,
} from './filters'

export interface QueueBoardProps {
  eventId: string
  eventCode: string
  /**
   * Whether to offer the "Go to import" shortcut on the empty state.
   *
   * The import route is admin-only, so showing this to an `event_team` member
   * would hand them a button that bounces them off `requireAdmin` with no
   * explanation. Resolved on the server by the page and passed down — this is
   * a client component and must never ask Supabase who it is talking to.
   */
  canImport: boolean
  /**
   * How many groups the SERVER can see on this event, counted during the
   * page render under a session that has already passed `requireStaff`.
   *
   * This exists to separate two states that are byte-identical on the client.
   * A PostgREST read that RLS refuses does not fail — it returns `[]` with no
   * error — so `rows.length === 0` means EITHER "this event has no families
   * yet" OR "this session was not allowed to see them". The board used to
   * assume the first and tell staff "the guest list has not been imported
   * yet", which sends someone hunting for an import that already ran. It was
   * reproduced on SAMPLE2026: 782 groups on the event, empty board, that
   * exact sentence.
   *
   * The commonest cause is a client session whose durable code token is
   * missing or expired while the httpOnly cookie is still valid — the server
   * renders the page fine and the browser's own query goes out anonymous.
   *
   * The server's count is the ground truth the client cannot obtain for
   * itself: if it is greater than zero and the client still sees nothing,
   * the read was refused, and the honest thing to show is a failure with a
   * way out rather than a story about the import.
   */
  knownGroupCount: number
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'ready'; rows: QueueGroupRow[] }
  | { phase: 'error'; message: string; rows: QueueGroupRow[] | null }

/**
 * Client-side board: reads filters from the URL, fetches `v_rsvp_queue`
 * under the viewer's own RLS, and keeps the list live via `postgres_changes`.
 * Refetches on any change rather than patching rows in place —
 * `attempt_count`, `next_callback_at` etc. are computed by the view, not
 * present on a raw change payload.
 *
 * REALTIME REQUIRES MIGRATION 20260731000800. Supabase ships an empty
 * `supabase_realtime` publication; until that migration is pushed these
 * subscriptions report SUBSCRIBED and then deliver nothing, forever. The
 * board still works — it just will not self-update.
 */
const QUEUE_OFFSET_KEY = 'eventflow:queue:offset'

/** Deterministic offset so simultaneous callers do not all begin at row 1. */
function getOrCreateOffset(): number {
  if (typeof window === 'undefined') return 0
  const stored = sessionStorage.getItem(QUEUE_OFFSET_KEY)
  if (stored !== null) return parseInt(stored, 10) || 0
  const offset = Math.floor(Math.random() * 12) // 0-11, just enough to spread 10 callers
  sessionStorage.setItem(QUEUE_OFFSET_KEY, String(offset))
  return offset
}

export function QueueBoard({
  eventId,
  eventCode,
  canImport,
  knownGroupCount,
}: QueueBoardProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const filters = useMemo(() => parseFilters(searchParams), [searchParams])

  const supabase = useMemo(() => createClient(), [])

  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  // Bumped by the Retry button to re-run the effect below.
  const [reloadToken, setReloadToken] = useState(0)

  const retry = useCallback(() => {
    setState({ phase: 'loading' })
    setReloadToken((n) => n + 1)
  }, [])

  // One effect owns both the initial/filter-change fetch and the realtime
  // subscriptions that re-trigger it. Kept together, with the fetch itself
  // local to the effect, so there is a single place that decides when a
  // fresh read of `v_rsvp_queue` is needed.
  useEffect(() => {
    let cancelled = false

    async function load() {
      let query = supabase.from('v_rsvp_queue').select('*').eq('event_id', eventId)

      if (filters.statuses.length > 0) {
        query = query.in('rsvp_status', filters.statuses)
      }
      if (filters.side) {
        query = query.eq('side', filters.side)
      }
      if (filters.callbackScheduled) {
        // `next_callback_at` is computed by the view as
        // `min(callback_at) filter (where callback_at > now())` — evaluated
        // against the SERVER clock, and already guaranteed to be in the
        // future. So the only correct client-side test is "is there one",
        // never a comparison against the phone's clock (which used to make
        // this filter return nothing at all, since every value it can hold
        // is already later than any honest `now`).
        query = query.not('next_callback_at', 'is', null)
      }
      if (filters.hideLocked) {
        query = query.eq('is_locked', false)
      }

      if (filters.callbackScheduled) {
        query = query.order('next_callback_at', { ascending: true })
      }

      const { data, error } = await traceFetch('queue :: v_rsvp_queue', () =>
        query
          .order('priority', { ascending: false })
          .order('head_name', { ascending: true }),
      )

      if (cancelled) return

      if (error) {
        // Never leave the board on a spinner that can never resolve: an
        // error is a terminal state with a way out, not "still loading".
        setState((prev) => ({
          phase: 'error',
          message: 'Could not load the calling queue. Check your connection and try again.',
          rows: prev.phase === 'ready' ? prev.rows : prev.phase === 'error' ? prev.rows : null,
        }))
        return
      }

      setState({ phase: 'ready', rows: data ?? [] })
    }

    void load()

    // Realtime: every phone on the team shares this data, so a lock taken
    // (or an outcome logged) on another device shows up here without a pull
    // to refresh.
    //
    // BOTH tables matter. `attempt_count`, `last_outcome` and
    // `next_callback_at` come entirely from `call_attempts`, and logging an
    // outcome writes nothing to `guest_groups` (see migration 0200: "Nothing
    // in this chain writes to guest_groups on its own"). Listening only to
    // `guest_groups` left those three columns stale team-wide.
    const channel = supabase
      .channel(`queue-${eventId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'guest_groups',
          filter: `event_id=eq.${eventId}`,
        },
        () => {
          void load()
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'call_attempts',
          filter: `event_id=eq.${eventId}`,
        },
        () => {
          void load()
        },
      )
      .subscribe()

    return () => {
      cancelled = true
      void supabase.removeChannel(channel)
    }
  }, [supabase, eventId, filters, reloadToken])

  function handleFilterChange(next: QueueFilterState) {
    const params = filtersToSearchParams(next)
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  const filtersActive = hasActiveFilters(filters)
  const rows = state.phase === 'ready' ? state.rows : state.phase === 'error' ? state.rows : null

  // Progress across the whole calling list. Suppressed while a filter is on:
  // the denominator would then be "families matching this filter", and a
  // progress bar whose denominator moves when you tap a chip is a bar that
  // lies. Better no bar than a wrong one.
  const progress =
    !filtersActive && rows !== null && rows.length > 0
      ? {
          contacted: rows.filter((r) => (r.rsvp_status ?? 'not_started') !== 'not_started')
            .length,
          total: rows.length,
        }
      : null

  return (
    <div className="flex flex-col gap-4">
      <PageTitle right="Priority ↓">Call queue</PageTitle>

      {progress ? (
        <div>
          <p className="flex items-baseline gap-2">
            <span className="figure text-base font-medium text-brand">
              {progress.contacted} of {progress.total}
            </span>
            <span className="text-sm text-muted">contacted</span>
          </p>
          <div
            className="mt-2.5 h-1 overflow-hidden rounded-full bg-surface-2"
            role="img"
            aria-label={`${progress.contacted} of ${progress.total} families contacted`}
          >
            <div
              className="h-full rounded-full bg-linear-to-r from-brand to-ledger-green transition-[width] duration-500 ease-ledger"
              style={{ width: `${(progress.contacted / progress.total) * 100}%` }}
            />
          </div>
        </div>
      ) : null}

      <QueueFilters filters={filters} onChange={handleFilterChange} />

      {state.phase === 'error' ? (
        <ErrorState
          title={state.message}
          description={
            state.rows
              ? 'Showing the last list that loaded. Your changes were saved.'
              : undefined
          }
          onRetry={retry}
        />
      ) : null}

      {state.phase === 'loading' ? (
        <LoadingRows count={8} />
      ) : rows === null ? null : rows.length === 0 ? (
        // Order matters: the refused-read case is checked BEFORE the filter
        // case. A stale session returns zero rows whether or not a filter is
        // set, and "no families match these filters" would be just as wrong an
        // explanation as the import one — it would send a caller clearing
        // filters that were never the problem.
        knownGroupCount > 0 ? (
          <ErrorState
            title="Could not load the calling queue"
            description={`This event has ${knownGroupCount} ${
              knownGroupCount === 1 ? 'family' : 'families'
            } on file, so this is a loading problem, not an empty list. Your sign-in may have expired — retry, and sign in again if it keeps happening.`}
            onRetry={retry}
          />
        ) : filtersActive ? (
          <EmptyState
            icon={<InboxIcon className="h-7 w-7" />}
            title="No families match these filters"
            description="Try clearing a filter — the queue isn't empty, this view just is."
            action={
              <Button
                variant="secondary"
                fullWidth
                onClick={() => handleFilterChange(DEFAULT_FILTERS)}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<UploadIcon className="h-7 w-7" />}
            title="Nothing to call yet"
            description={
              canImport
                ? 'Import the guest list to fill this queue with families to call.'
                : 'The guest list has not been imported yet. An admin loads the calling list, and families appear here as soon as they do.'
            }
            action={
              canImport ? (
                <Button fullWidth onClick={() => router.push(`/${eventCode}/guests/import`)}>
                  Go to import
                </Button>
              ) : undefined
            }
          />
        )
      ) : (
        <>
          <ol className="flex flex-col gap-2.5" aria-label="Families to call">
            {rows.map((row, index) => (
              <li
                key={row.group_id ?? `${row.head_name}-${row.primary_mobile}`}
                style={staggerDelay(index)}
              >
                <QueueRow row={row} eventCode={eventCode} />
              </li>
            ))}
          </ol>

          {/* The one thing about this screen worth knowing, said once at the
              bottom rather than in a tooltip nobody opens. */}
          <p className="pt-1 text-center text-xs leading-relaxed text-muted">
            Attempt count is counted, never stored — two offline phones cannot drift
            it.
          </p>
        </>
      )}
    </div>
  )
}

export default QueueBoard
