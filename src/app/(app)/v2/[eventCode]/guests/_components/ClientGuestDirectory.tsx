'use client'

import { useMemo, useState } from 'react'

import { SearchIcon, UsersIcon } from '@/components/icons'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { listClientGuests, type ClientGuestRow } from '@/lib/actions/client-guests'
import { traceFetch } from '@/lib/perf'
import { selectClientRows } from '@/lib/store/selectors'
import { useEventStore, useEventStoreMode } from '@/lib/store/useEventStore'
import { useStableData } from '@/lib/use-stable-data'

import {
  GuestResultRow,
  GuestSearchField,
  GuestSheet,
  type GuestSheetData,
} from './parts'

/** Guests rendered per page. Keeps the first paint bounded on a 543-row event. */
const GUESTS_PER_PAGE = 40

/** Below this many characters a search is not yet a search. */
const MIN_SEARCH = 2

export interface ClientGuestDirectoryProps {
  eventId: string
}

/**
 * The client's guest list — the only screen a `client` login can use.
 *
 * ── Why this is not the staff directory next door ──────────────────────────
 * The staff screen reads `search_guest_profiles`, which runs as the invoker. A
 * client gets zero rows from it and would be shown a confident, fabricated
 * "Nothing matches" on a wedding with 238 families. This one reads
 * `client_guest_profiles`, which is the row set the client already has, so the
 * search can be answered from the phone with no network at all.
 *
 * ── Why it pages ───────────────────────────────────────────────────────────
 * The original version of this screen mounted every card at once. The database
 * answered in ~5ms and the WebView then spent 26 seconds laying out 543
 * variable-height cards. The v3 row is a fixed 64px, which is what makes a
 * plain list safe here where a variable-height card was not — but the list
 * still grows on demand rather than all at once, because the first paint of a
 * client's guest list is the one screen they open on venue Wi-Fi.
 *
 * ── No way out, on purpose ─────────────────────────────────────────────────
 * Nothing on this screen links. The family record is a staff screen, so a row
 * that opened it would bounce the person who tapped it (the reason
 * `FindResultRow` renders a link only when it is given an href). Tapping opens
 * the sheet, and the sheet has one button: Close.
 */
export function ClientGuestDirectory({ eventId }: ClientGuestDirectoryProps) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  /**
   * THE STORE FIRST, `useStableData` AS THE FALLBACK.
   *
   * A client's whole event is one row per guest from `client_guest_profiles`,
   * which the snapshot ships verbatim under its own key — the migration sends it
   * for clients AND for staff precisely so this screen and the staff directory
   * cannot drift apart. With the store live this screen touches the network
   * once, on the cold start, and then never again: the TTL cache it used to
   * depend on was already an attempt at the same idea, kept in a module Map
   * instead of IndexedDB and lost on every app restart.
   */
  const storeMode = useEventStoreMode()
  const storeRows = useEventStore(selectClientRows)
  const storeLive = storeMode === 'store'

  const { data: cachedRows, loading, error, reload } = useStableData<ClientGuestRow[]>(
    // The SAME cache key the staff-side client list used, deliberately: a
    // client who has opened this screen once can search it with no network.
    `client-guests:${eventId}`,
    async () => {
      const result = await traceFetch('client guests :: load', () => listClientGuests(eventId))
      if (!result.ok) throw new Error(result.message)
      return result.rows
    },
    // Nothing to fetch while the store is live — and nothing during the
    // 'loading' window either, which is why this is `!== 'fallback'` rather
    // than `=== 'store'`: the mode is unknown for the first frames, and firing
    // the request there would spend exactly the round trip the store is about
    // to make unnecessary.
    { disabled: storeMode !== 'fallback' },
  )

  const rows = storeLive ? storeRows : cachedRows

  const q = search.trim().toLocaleLowerCase()
  const searchActive = q.length >= MIN_SEARCH

  const matches = useMemo(() => {
    const all = rows ?? []
    if (!searchActive) return all
    return all.filter(
      (row) =>
        row.guest_name?.toLocaleLowerCase().includes(q) ||
        row.family_head?.toLocaleLowerCase().includes(q) ||
        row.room_number?.toLocaleLowerCase().includes(q),
    )
  }, [rows, searchActive, q])

  const shown = searchActive ? matches : matches.slice(0, page * GUESTS_PER_PAGE)
  const remaining = matches.length - shown.length

  const loadError = error instanceof Error ? error.message : error ? String(error) : null
  const open = openIndex === null ? null : (shown[openIndex] ?? null)

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

  if (loading && !rows) {
    return (
      <div className="flex flex-col gap-2" aria-busy>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex min-h-16 items-center gap-3 rounded-xl border border-rule bg-surface px-3">
            <div className="h-10 w-10 shrink-0 rounded-full bg-rule" />
            <div className="min-w-0 flex-1">
              <div className="h-4 w-2/5 rounded bg-rule-strong" />
              <div className="mt-2 h-3 w-3/5 rounded bg-rule" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if ((rows?.length ?? 0) === 0) {
    return (
      <EmptyState
        icon={<UsersIcon className="h-7 w-7" />}
        title="No guest details yet"
        description="Nothing has been shared on this event yet. Ask your event team — nothing has gone wrong."
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <GuestSearchField
        value={search}
        onChange={(next) => {
          setSearch(next)
          setOpenIndex(null)
          // Reset paging here, in the event handler, not in an effect:
          // narrowing the search must not leave the reader on page 4 of a
          // result set that no longer has one, and a synchronous setState
          // inside an effect cascades renders.
          setPage(1)
        }}
        placeholder="Name or room number"
        busy={false}
      />

      <p role="status" className="px-1 text-sm text-muted">
        {searchActive
          ? matches.length === 0
            ? 'No guest matches that name'
            : `${matches.length} ${matches.length === 1 ? 'guest' : 'guests'}`
          : `${rows?.length ?? 0} guests · read-only`}
      </p>

      {matches.length === 0 ? (
        <EmptyState
          icon={<SearchIcon className="h-7 w-7" />}
          title="Nothing matches"
          description="Try a different spelling, or part of the family head's name."
        />
      ) : (
        <div
          className="overflow-hidden rounded-2xl border border-rule-strong bg-surface"
          role="list"
          aria-label="Guests"
        >
          {shown.map((row, index) => (
            <div key={row.guest_id ?? `${row.guest_name}|${index}`} role="listitem">
              <GuestResultRow
                guest={row}
                term={searchActive ? search : ''}
                onPress={() => setOpenIndex(index)}
              />
            </div>
          ))}
        </div>
      )}

      {remaining > 0 ? (
        <Button variant="secondary" fullWidth onClick={() => setPage((p) => p + 1)}>
          Show {Math.min(remaining, GUESTS_PER_PAGE)} more
          {remaining > GUESTS_PER_PAGE ? ` of ${remaining}` : ''}
        </Button>
      ) : null}

      <GuestSheet
        guest={(open as GuestSheetData | undefined) ?? null}
        open={open !== null}
        onClose={() => setOpenIndex(null)}
        // Never a link: every staff destination would bounce a client off the
        // screen they just found.
        familyHref={null}
      />
    </div>
  )
}

export default ClientGuestDirectory
