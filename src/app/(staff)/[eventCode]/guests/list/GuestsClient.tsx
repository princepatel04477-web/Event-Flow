'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import { ChevronRightIcon, SearchIcon, UsersIcon } from '@/components/icons'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { listGuests, searchGuests, type GuestSearchRow } from '@/lib/actions/search-guests'
import { traceFetch } from '@/lib/perf'
import { useStableData } from '@/lib/use-stable-data'
import { cn } from '@/lib/utils'
import { formatMobile } from '@/lib/phone'
import { describeRoom, groupTypeLabel, sideLabel } from './_components/format'

/**
 * The guest list, as a windowed (virtualised) list with server-side search.
 *
 * WHY WINDOWED: at 543 guests the old server-rendered list mounted every
 * card at once — the DB answered in ~5ms and the WebView spent the other
 * 26 seconds rendering 543 variable-height cards. This list mounts only
 * the rows near the viewport (plus an overscan), so first paint is bound
 * by the visible rows, not the total. Every row is still reachable by
 * scrolling — the container is the full list height; the DOM holds a
 * window of it.
 *
 * The row is deliberately compact and fixed-height. The rich per-guest
 * detail (travel legs, badges, stay) lives on the family's RSVP record,
 * which every row links to — a staff member in a hotel lobby wants to
 * find ONE family and open it, not read all 543 cards.
 *
 * Search is server-side (the search_guest_profiles RPC + trgm indexes,
 * migration 1800/1801), debounced 300ms, and caps at 50 results — search
 * is for finding one family, not paging the world.
 */

/** Fixed pixel height of one virtualised row. Must match GuestListRow's CSS. */
const ROW_HEIGHT = 76
/** Rows rendered above and below the viewport so scrolling never flashes empty. */
const OVERSCAN = 6
/** Debounce before firing a server search. */
const SEARCH_DEBOUNCE_MS = 300

export interface GuestsClientProps {
  eventId: string
  eventCode: string
}

export function GuestsClient({ eventId, eventCode }: GuestsClientProps) {
  const [search, setSearch] = useState('')
  const [searchRows, setSearchRows] = useState<GuestSearchRow[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load the full ordered row set once, cached for tab switches (the
  // module-level TTL survives unmounting — same pattern as every board).
  // The list goes through the SAME staff-facing RPC as search (not the
  // client_guest_profiles view) so every row carries `group_id` — each
  // row links to its family's RSVP record.
  const { data: rows, loading, error, reload } = useStableData<GuestSearchRow[] | null>(
    `guests:${eventId}`,
    async () => {
      const result = await traceFetch('guests :: load', () => listGuests(eventId))
      if (!result.ok) {
        throw new Error(result.message || 'Could not load the guest list. Check your connection and try again.')
      }
      return result.rows
    },
  )

  // Debounced server-side search. The effect owns the timer: typing keeps
  // resetting it, and only a 300ms pause fires the RPC. The "cleared"
  // state is handled in onChange below (an effect must not setState
  // synchronously).
  const q = search.trim()
  const searchActive = q.length >= 2
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!searchActive) return

    debounceRef.current = setTimeout(async () => {
      const result = await searchGuests(eventId, q)
      if (result.ok) {
        setSearchRows(result.rows)
        setSearchError(null)
      } else {
        setSearchRows(null)
        setSearchError(result.message)
      }
      setSearching(false)
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [search, searchActive, q, eventId])

  // A non-empty search with no results yet and no error is "in flight".
  const isSearching = searching || (searchActive && searchRows === null && !searchError)

  // The windowed slice: which rows are near the viewport right now.
  const list = useMemo(() => (searchActive ? searchRows ?? [] : rows ?? []), [searchActive, searchRows, rows])
  const total = rows?.length ?? 0
  const shownTotal = searchRows ? searchRows.length : total

  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const visibleCount = Math.ceil(typeof window === 'undefined' ? 12 : window.innerHeight / ROW_HEIGHT) + OVERSCAN * 2
  const endIndex = Math.min(list.length, startIndex + visibleCount)
  const windowRows = useMemo(() => list.slice(startIndex, endIndex), [list, startIndex, endIndex])

  const loadError = error instanceof Error ? error.message : error ? String(error) : null

  // Pull-to-refresh on a pointer/touch drag is the board pattern; here a
  // refresh button in the error state is the recovery action, and the
  // list itself re-fetches on tab re-entry via the TTL cache.
  if (loadError && !rows) {
    return (
      <EmptyState
        icon={<UsersIcon className="h-7 w-7" />}
        title="Could not load the guest list"
        description={loadError}
        action={<Button onClick={() => void reload()}>Try again</Button>}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold text-fg">Guest list</h2>
        <p className="mt-0.5 text-sm text-muted">
          {total} {total === 1 ? 'guest' : 'guests'} · read-only. Tap a guest to open their
          family&apos;s record.
        </p>
      </div>

      {/* Search — server-side, debounced, lives in the component state. */}
      <div className="flex items-center gap-2 rounded-xl border border-border-strong bg-surface px-3">
        <SearchIcon className="h-5 w-5 shrink-0 text-muted" />
        <input
          type="search"
          value={search}
          onChange={(e) => {
            const next = e.target.value
            setSearch(next)
            // Clearing the search returns to the full list immediately —
            // resetting here (in the event handler, not an effect) avoids a
            // synchronous setState inside the debounce effect.
            if (next.trim().length < 2) {
              setSearchRows(null)
              setSearchError(null)
              setSearching(false)
            }
          }}
          placeholder="Search by name or mobile"
          aria-label="Search guests"
          className="min-h-12 w-full bg-transparent text-base text-fg placeholder:text-subtle focus:outline-none"
        />
        {isSearching ? (
          <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-rule-strong border-t-brand" aria-hidden />
        ) : null}
      </div>

      {searchError ? (
        <p className="rounded-xl border border-border-strong bg-tint-warning px-3 py-2 text-sm font-medium text-warning">
          {searchError}
        </p>
      ) : null}

      {loading && !rows ? (
        // Skeleton rows shaped like the virtualised rows, so the screen
        // does not flash a false "no guests" empty state.
        <div className="flex flex-col gap-2" aria-busy>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="rounded-2xl border border-border bg-surface p-4">
              <div className="h-5 w-2/5 rounded bg-rule-strong" />
              <div className="mt-2 h-4 w-3/4 rounded bg-rule" />
            </div>
          ))}
        </div>
      ) : total === 0 && !search ? (
        <EmptyState
          icon={<UsersIcon className="h-7 w-7" />}
          title="No guest details yet"
          description="Nothing has been shared on this event yet. Usually that means the guest list has not been imported, or your account is on the event but no guests are linked to it. Ask your event team — nothing has gone wrong."
        />
      ) : searchActive && isSearching ? (
        // Search is in flight (300ms debounce + RPC round-trip). Show a
        // skeleton, NOT a false "Nothing matches" — the empty state must
        // only appear once the server actually answered with zero rows.
        <div className="flex flex-col gap-2" aria-busy>
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="rounded-2xl border border-border bg-surface p-4">
              <div className="h-5 w-2/5 rounded bg-rule-strong" />
              <div className="mt-2 h-4 w-3/4 rounded bg-rule" />
            </div>
          ))}
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={<SearchIcon className="h-7 w-7" />}
          title="Nothing matches"
          description="No guest matches that search. Try a different spelling or a few digits of their mobile."
        />
      ) : (
        <>
          {shownTotal !== total && search ? (
            <p className="text-sm text-muted">{shownTotal} match{shownTotal === 1 ? '' : 'es'}</p>
          ) : null}

          {/* The windowed list: a full-height scroll container holding a
              positioned window of rows. Only `windowRows` are mounted. */}
          <div
            className="relative overflow-hidden rounded-2xl border border-border bg-surface"
            style={{ height: list.length * ROW_HEIGHT }}
            role="list"
            aria-label="Guests"
          >
            <div
              className="absolute inset-0 overflow-y-auto"
              onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            >
              <div
                className="relative"
                style={{ height: list.length * ROW_HEIGHT }}
                data-testid="guest-list-window"
              >
                {windowRows.map((row, i) => {
                  const index = startIndex + i
                  return (
                    <div
                      key={row.guest_id ?? `guest-${index}`}
                      className="absolute inset-x-0 px-3 py-2"
                      style={{ top: index * ROW_HEIGHT, height: ROW_HEIGHT }}
                    >
                      <GuestListRow row={row} eventCode={eventCode} />
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * One compact, fixed-height row. Links to the family's RSVP record — the
 * operational "profile" for a guest (call history, travel, RSVP outcome).
 * The link is the whole row, so the 44px tap target is the entire card.
 */
function GuestListRow({ row, eventCode }: { row: GuestSearchRow; eventCode: string }) {
  const groupId = row.group_id ?? null
  const name = row.guest_name?.trim() || 'Name not recorded'
  const head = row.family_head?.trim() || null
  const room = describeRoom(row)
  const phone = row.phone ?? null
  const chips = [
    groupTypeLabel(row.group_type),
    sideLabel(row.side),
    typeof row.pax === 'number' ? `Family of ${row.pax}` : null,
  ].filter(Boolean)

  const href = groupId ? `/${eventCode}/rsvp/${groupId}` : null

  const inner = (
    <div className="flex h-full items-center gap-3 px-4">
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-fg">{name}</p>
        <p className="mt-0.5 truncate text-sm text-muted">
          {head && head !== name ? `Family of ${head} · ` : ''}
          {room}
        </p>
        {chips.length > 0 ? (
          <p className="mt-0.5 truncate text-xs text-subtle">{chips.join(' · ')}</p>
        ) : null}
      </div>
      <div className="shrink-0 text-right">
        {phone ? <p className="text-sm font-medium text-brand">{formatMobile(phone)}</p> : null}
        <ChevronRightIcon className="ml-auto h-5 w-5 text-muted" />
      </div>
    </div>
  )

  const cls = cn(
    'flex h-full items-center rounded-2xl border border-border bg-surface active:bg-surface-2',
  )

  if (!href) {
    return <div className={cls}>{inner}</div>
  }

  return (
    <a href={href} className={cls} role="listitem">
      {inner}
    </a>
  )
}

export default GuestsClient
