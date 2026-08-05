'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { UploadIcon, InboxIcon } from '@/components/icons'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { LoadingRows } from '@/components/ui/LoadingRows'
import { SectionHead } from '@/components/ui/SectionHead'
import { createClient } from '@/lib/supabase/client'
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
export function QueueBoard({ eventId, eventCode, canImport }: QueueBoardProps) {
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

      const { data, error } = await query
        .order('priority', { ascending: false })
        .order('head_name', { ascending: true })

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

  return (
    <div className="flex flex-col gap-4">
      <SectionHead
        eyebrow="Calling queue"
        title="Families to call"
      />

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
        filtersActive ? (
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
                <Button fullWidth onClick={() => router.push(`/${eventCode}/import`)}>
                  Go to import
                </Button>
              ) : undefined
            }
          />
        )
      ) : (
        <ol
          className="list-fade relative ml-3 flex flex-col gap-px"
          aria-label="Families to call"
        >
          {/* The ledger's margin rule: one continuous red line down the
              leading edge of the list. Attention states break into it.
              The 12px left margin gives the band room to read as ruled
              paper, not a border. */}
          <span
            aria-hidden
            className="absolute top-1 bottom-1 -left-3 w-0.5 rounded-full bg-ledger-red"
          />
          {rows.map((row, index) => (
            <li key={row.group_id ?? `${row.head_name}-${row.primary_mobile}`}>
              <ListRowWrap banded={index % 2 === 1}>
                <QueueRow row={row} eventCode={eventCode} />
              </ListRowWrap>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/**
 * The alternating paper band lives on the list item, not inside QueueRow:
 * the row itself is one shape everywhere; the list decides the banding.
 */
function ListRowWrap({ banded, children }: { banded: boolean; children: ReactNode }) {
  return <div className={banded ? 'bg-paper-band' : 'bg-paper'}>{children}</div>
}

export default QueueBoard
