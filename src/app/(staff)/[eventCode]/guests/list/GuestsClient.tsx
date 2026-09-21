'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { ChevronRightIcon, SearchIcon, UsersIcon } from '@/components/icons'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import type { GuestSearchRow } from '@/lib/actions/search-guests'
import { traceFetch } from '@/lib/perf'
import { queryKeys } from '@/lib/query/keys'
import { readGuestSearch, readGuestsList } from '@/lib/query/reads'
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

/**
 * Fixed pixel height of one virtualised row. Must match GuestListRow's CSS.
 *
 * THE NUMBER IS A BUDGET, AND IT WAS OVERDRAWN. The row wrapper spends
 * `py-2` (16px) before the card gets anything, and the card renders three
 * lines: name (text-base, 24px line box), room (text-sm + mt-0.5, 22px) and
 * the chips (text-xs + mt-0.5, 18px). That is 64px of content and 16px of
 * padding — 80px, plus the card's own 2px of border — inside what used to be
 * 76. The third line therefore rendered THROUGH the card's bottom border and
 * into the row beneath it, which reads on a handset as struck-through text
 * and rows that collide.
 *
 * The overflow is arithmetic and predates the re-skin; Be Vietnam Pro's
 * taller x-height is what made a marginal 4px spill into an obvious one.
 * Raised to 88 so the content fits with headroom rather than trimming a line
 * the event team asked for.
 *
 * If a fourth line is ever added here, this number moves with it. There is no
 * mechanism that catches the mismatch — the wrapper and the card agree only
 * because a human keeps them in step.
 */
const ROW_HEIGHT = 88
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
  // The term the server actually searched for. Separate from `search` so the
  // input stays instant while the request is debounced, and so the query key
  // only changes when a request is genuinely due.
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [scrollTop, setScrollTop] = useState(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load the full ordered row set once, then serve it from the shared cache on
  // every later visit — tab switches, back-taps, and the detail screens all
  // read the same entry under the same event-scoped key. See
  // docs/INTERACTION-CONTRACT.md T4.
  //
  // The list goes through the SAME staff-facing RPC as search (not the
  // client_guest_profiles view) so every row carries `group_id` — each
  // row links to its family's RSVP record.
  const {
    data: rows,
    isPending: loading,
    isFetching: listFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: queryKeys.guests.list(eventId),
    queryFn: () => traceFetch('guests :: load', () => readGuestsList(eventId)),
  })

  // The list is on screen and being re-read behind it. Said quietly, because
  // the alternative T4 forbids is throwing 543 cached rows away for a skeleton
  // on every re-entry. Distinct from `searchStale` below, which dims the
  // PREVIOUS term's results while a new term is in flight.
  const listStale = listFetching && rows !== undefined

  // Debounced server-side search. The effect owns the timer: typing keeps
  // resetting it, and only a 300ms pause promotes the term into the key. The
  // "cleared" state is handled in onChange below (an effect must not
  // setState synchronously).
  const q = search.trim()
  const searchActive = q.length >= 2
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    // Dropping below the minimum is handled in onChange below, not here: an
    // effect must not setState synchronously (react-hooks/set-state-in-effect),
    // and the only thing that can shorten the term is the user typing.
    if (!searchActive) return

    debounceRef.current = setTimeout(() => setDebouncedSearch(q), SEARCH_DEBOUNCE_MS)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [searchActive, q])

  const {
    data: searchRows,
    isFetching: searchFetching,
    isPlaceholderData: searchStale,
    error: searchError,
  } = useQuery({
    queryKey: queryKeys.guests.search(eventId, debouncedSearch),
    queryFn: () => traceFetch('guests :: search', () => readGuestSearch(eventId, debouncedSearch)),
    enabled: debouncedSearch.length >= 2,
    // T4: while a NEW search is in flight the PREVIOUS results stay on screen
    // and only dim. Replacing them with a skeleton on every keystroke is the
    // screen "blinking", and it makes a 300ms debounce feel like a stall.
    placeholderData: keepPreviousData,
  })

  // The previous term's rows stay visible while the new term loads, and
  // `isPlaceholderData` below is what marks them as old. An earlier version also
  // required `debouncedSearch === q` here, which threw the placeholder away the
  // moment the typed term moved ahead of the debounced one — so the list blinked
  // to a skeleton on every keystroke and the `keepPreviousData` above was dead
  // code. That is the behaviour T4 explicitly forbids.
  const activeSearchRows = searchActive ? searchRows : undefined

  // "In flight" only describes a search with nothing to show yet. Once
  // placeholder rows exist, the screen is showing something and the honest
  // signal is the dimming, not a skeleton.
  const isSearching = searchActive && searchFetching

  // The windowed slice: which rows are near the viewport right now.
  const list = useMemo(
    () => (searchActive ? activeSearchRows ?? [] : rows ?? []),
    [searchActive, activeSearchRows, rows],
  )
  const total = rows?.length ?? 0
  const shownTotal = activeSearchRows ? activeSearchRows.length : total

  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const visibleCount = Math.ceil(typeof window === 'undefined' ? 12 : window.innerHeight / ROW_HEIGHT) + OVERSCAN * 2
  const endIndex = Math.min(list.length, startIndex + visibleCount)
  const windowRows = useMemo(() => list.slice(startIndex, endIndex), [list, startIndex, endIndex])

  const loadError = error instanceof Error ? error.message : error ? String(error) : null
  const searchErrorMessage = searchError instanceof Error ? searchError.message : null

  // Pull-to-refresh on a pointer/touch drag is the board pattern; here a
  // refresh button in the error state is the recovery action, and the
  // list itself is served from the shared cache on tab re-entry.
  if (loadError && !rows) {
    return (
      <EmptyState
        icon={<UsersIcon className="h-7 w-7" />}
        title="Could not load the guest list"
        description={loadError}
        action={<Button onClick={() => void refetch()}>Try again</Button>}
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
        {listStale ? (
          <p role="status" className="mt-0.5 text-xs text-muted">
            Updating…
          </p>
        ) : null}
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
              setDebouncedSearch('')
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

      {searchErrorMessage ? (
        <p className="rounded-xl border border-border-strong bg-tint-warning px-3 py-2 text-sm font-medium text-warning">
          {searchErrorMessage}
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
      ) : searchActive && isSearching && !activeSearchRows ? (
        // Search is in flight AND there is nothing to show yet (300ms debounce +
        // RPC round trip on a cold term). Show a skeleton, NOT a false "Nothing
        // matches" — the empty state must only appear once the server actually
        // answered with zero rows.
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
              positioned window of rows. Only `windowRows` are mounted.
              Dimmed while the results shown are the PREVIOUS term's — the
              staleness is visible, which is what makes showing them honest
              rather than a lie (T4). */}
          <div
            className={cn(
              'relative overflow-hidden rounded-2xl border border-border bg-surface',
              searchStale && 'opacity-60',
            )}
            style={{ height: list.length * ROW_HEIGHT }}
            role="list"
            aria-label="Guests"
            aria-busy={searchStale || undefined}
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

  const href = groupId ? `/${eventCode}/rsvp/status/${groupId}` : null

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
    // `Link`, not a bare `<a>`. A plain anchor is a full document navigation,
    // and in remote-shell mode (CLAUDE.md §11c) there is no local bundle — so
    // every guest tap threw the whole app away and re-fetched it from Vercel,
    // cache and all. A soft navigation fetches only the destination and leaves
    // the shell, the query cache and the undo bar standing.
    //
    // `prefetch={false}` is NOT a performance oversight, it is a safety
    // requirement, and it is the reason this row is not armed by
    // `useBoundedPrefetch` like the nav tabs are. A full prefetch runs the
    // destination's server render for real, and `rsvp/status/[groupId]` calls
    // `claimGroupForCall` on render — it TAKES THE 15-MINUTE CALLER LOCK. A
    // list that prefetched under the thumb would lock families nobody opened,
    // and a lock has no manual override: it expires or it does not clear
    // (CLAUDE.md §11b). Prefetching this route is a data bug wearing a
    // performance costume.
    <Link href={href} prefetch={false} className={cls} role="listitem">
      {inner}
    </Link>
  )
}

export default GuestsClient
