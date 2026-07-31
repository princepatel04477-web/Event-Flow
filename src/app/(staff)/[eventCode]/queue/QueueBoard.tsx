'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { UploadIcon, InboxIcon, ShieldAlertIcon } from '@/components/icons'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Spinner } from '@/components/ui/Spinner'
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
}

/**
 * Client-side board: reads filters from the URL, fetches `v_rsvp_queue`
 * under the viewer's own RLS, and keeps the list live via `postgres_changes`
 * on `guest_groups`. Refetches on any change rather than patching rows in
 * place — `attempt_count`, `next_callback_at` etc. are computed by the view,
 * not present on the raw `guest_groups` change payload.
 */
export function QueueBoard({ eventId, eventCode }: QueueBoardProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const filters = useMemo(() => parseFilters(searchParams), [searchParams])

  const supabase = useMemo(() => createClient(), [])

  const [rows, setRows] = useState<QueueGroupRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  // One effect owns both the initial/filter-change fetch and the realtime
  // subscription that re-triggers it. Kept together, with the fetch itself
  // local to the effect, so there is a single place that decides when a
  // fresh read of `v_rsvp_queue` is needed.
  //
  // Refetches the whole list on any change rather than patching rows in
  // place — `attempt_count`, `next_callback_at` etc. are computed by the
  // view, not present on the raw `guest_groups` change payload.
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
      if (filters.callbackDue) {
        query = query.lte('next_callback_at', new Date().toISOString())
      }
      if (filters.hideLocked) {
        query = query.eq('is_locked', false)
      }

      const { data, error } = await query
        .order('priority', { ascending: false })
        .order('head_name', { ascending: true })

      if (cancelled) return

      if (error) {
        setLoadError('Could not load the calling queue. Check your connection and try again.')
        return
      }

      setLoadError(null)
      setRows(data ?? [])
    }

    void load()

    // Realtime: every phone on the team shares this table, so a lock taken
    // (or an outcome logged) on another device shows up here without a pull
    // to refresh.
    const channel = supabase
      .channel(`queue-guest-groups-${eventId}`)
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
      .subscribe()

    return () => {
      cancelled = true
      void supabase.removeChannel(channel)
    }
  }, [supabase, eventId, filters])

  function handleFilterChange(next: QueueFilterState) {
    const params = filtersToSearchParams(next)
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  const isLoading = rows === null
  const filtersActive = hasActiveFilters(filters)

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold text-fg">Calling queue</h2>
        <p className="mt-0.5 text-sm text-muted">
          Sorted by priority. Tap a family to claim it and open the call.
        </p>
      </div>

      <QueueFilters filters={filters} onChange={handleFilterChange} />

      {loadError ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-danger bg-tint-danger px-4 py-3 text-sm font-medium text-danger"
        >
          <ShieldAlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{loadError}</span>
        </div>
      ) : null}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      ) : rows.length === 0 ? (
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
            description="Import the guest list to fill this queue with families to call."
            action={
              <Button fullWidth onClick={() => router.push(`/${eventCode}/import`)}>
                Go to import
              </Button>
            }
          />
        )
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.group_id ?? `${row.head_name}-${row.primary_mobile}`}>
              <QueueRow row={row} eventCode={eventCode} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default QueueBoard
