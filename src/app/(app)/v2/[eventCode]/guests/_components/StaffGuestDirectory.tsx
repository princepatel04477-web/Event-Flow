'use client'

import { useEffect, useRef, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { SearchIcon, UsersIcon } from '@/components/icons'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { LoadingRows } from '@/components/ui/LoadingRows'
import { queryKeys } from '@/lib/query/keys'
import { findGuests } from '@/lib/query/reads'
import { useOnline } from '@/lib/useOnline'
import { cn } from '@/lib/utils'

import {
  GuestResultRow,
  GuestSearchField,
  GuestSheet,
  type GuestSheetData,
} from './parts'

/** Below this many characters a search is not yet a search. Matches the app. */
const MIN_SEARCH = 2
/** 250ms, per the brief. Long enough to finish a word, short enough to feel live. */
const DEBOUNCE_MS = 250

export interface StaffGuestDirectoryProps {
  eventId: string
  eventCode: string
  /**
   * `find` is the search button in a header; `guests` is the same screen
   * reached from the app's own links. The only difference is the words in the
   * empty state, and they differ because the reader arrived differently.
   */
  from?: 'find' | 'guests'
  /**
   * Whether this viewer may open a family's RSVP record.
   *
   * Resolved SERVER-SIDE (see `mayOpenCallRecords`) and required rather than
   * defaulted: the destination is behind `requireSection(..., 'rsvp')`, which
   * admits management and admins only, while the search button that reaches
   * this screen is in every header. A default here would silently re-offer a
   * button that bounces four of the five departments (`docs/BUGS.md` M3).
   */
  canOpenFamilyRecord: boolean
}

/**
 * The guest directory, for staff and admins.
 *
 * ── One screen, two doors ──────────────────────────────────────────────────
 * SPEC-V3 §3 removes Guests as a tab ("Guests / Find = the search button in
 * every header") and §4 gives the one screen its shape: search field on top,
 * Rows, tap = guest sheet. So `/find` and `/guests` render THIS component.
 *
 * ── Server-side, one bounded read per term ─────────────────────────────────
 * The term goes into the `where` clause (`findGuests` in
 * `src/lib/query/reads.ts`); the guest list is never pulled to the phone to be
 * filtered there, which at 465 guests over venue Wi-Fi is the thing this brief
 * is written to prevent. What comes back is capped at 50 rows.
 *
 * ── T4: typing never blanks the results ────────────────────────────────────
 * `placeholderData: keepPreviousData` holds the previous term's rows on screen
 * while the next one is in the air, `isPlaceholderData` marks them, and the
 * list dims rather than disappearing. The spinner in the field is rendered
 * ONLY while there is nothing to show yet, so a 250ms debounce plus a Seoul
 * round trip never reads as a stall.
 *
 * ── Offline is a state, not an error (T7) ──────────────────────────────────
 * When the device says it is offline the query is not fired at all —
 * `networkMode: 'always'` would otherwise attempt it and surface a transport
 * failure as a load error — and the screen says, in one line, that search
 * needs a signal and offers the list that is already on the phone.
 */
export function StaffGuestDirectory({
  eventId,
  eventCode,
  from = 'find',
  canOpenFamilyRecord,
}: StaffGuestDirectoryProps) {
  const [term, setTerm] = useState('')
  const [debounced, setDebounced] = useState('')
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const online = useOnline()

  const query = term.trim()
  const searchActive = query.length >= MIN_SEARCH

  // The timer owns the promotion of a typed term into the query key — it is
  // reset on every keystroke, so only a 250ms pause issues a request. The
  // "too short" case is NOT handled here: an effect must not setState
  // synchronously (react-hooks/set-state-in-effect), and — more importantly —
  // the previous term's key is deliberately kept until either a new search is
  // due or the box is emptied, which is what stops the list blanking mid-word.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!searchActive) return
    debounceRef.current = setTimeout(() => setDebounced(query), DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [searchActive, query])

  // The state the QUERY is in, which is not the state the KEYBOARD is in. A
  // term is only asked about once the debounce has promoted it, so these two
  // lag by up to 250ms — and the query reads THIS rather than `searchActive`,
  // so the request and the list cannot disagree about what has been asked for.
  const canSearch = debounced.length >= MIN_SEARCH && online

  const {
    data: rows,
    isFetching,
    isPlaceholderData,
    error,
    refetch,
  } = useQuery({
    queryKey: queryKeys.guests.find(eventId, debounced),
    queryFn: () => findGuests(eventId, debounced, { withMobile: true }),
    // KEYED ON THE DEBOUNCED TERM, not on what is being typed. `searchActive`
    // would keep the query enabled between the two — the typed term is two
    // characters old while the key still names the previous one — and TanStack
    // treats a disabled query as one whose data is not current, which drops the
    // `keepPreviousData` rows and blanks the list on the FIRST keystroke of
    // every new term. That blink is precisely what T4 forbids.
    enabled: canSearch,
    placeholderData: keepPreviousData,
  })

  const offline = !online
  const list = canSearch && rows ? rows : []
  const searchError = error instanceof Error ? error.message : null

  // "What is on screen is not the answer to what is typed." True for the whole
  // debounce window as well as the fetch after it, because `debounced` still
  // names the previous term until the timer promotes the new one.
  const showingStale = searchActive && (isPlaceholderData || debounced !== query)
  const searching = searchActive && online && (isFetching || debounced !== query)
  const firstSearchInFlight = searching && list.length === 0

  const open = openIndex === null ? null : (list[openIndex] ?? null)

  async function retry() {
    setDebounced(query)
    await refetch()
  }

  return (
    <div className="flex flex-col gap-3">
      <GuestSearchField
        value={term}
        onChange={(next) => {
          setTerm(next)
          setOpenIndex(null)
          // The query key is cleared only when the BOX is cleared, not when the
          // term drops under the minimum. That distinction is the whole of
          // "typing never blanks the results".
          if (next.trim().length === 0) setDebounced('')
        }}
        placeholder="Name, last 4 digits, or room"
        busy={firstSearchInFlight}
      />

      {!searchActive ? (
        <EmptyState
          icon={<SearchIcon className="h-7 w-7" />}
          title={from === 'guests' ? 'Search the guest list' : 'Find someone'}
          description={`Type at least ${MIN_SEARCH} letters — a name, the last four digits of the family's mobile, or a room number.`}
        />
      ) : offline ? (
        <EmptyState
          icon={<UsersIcon className="h-7 w-7" />}
          title="Search needs a signal"
          description="Nothing can be looked up right now. Whatever you already saved will send itself when the signal comes back."
        />
      ) : searchError ? (
        <ErrorState
          title="Search did not answer"
          description={
            rows
              ? 'Showing the last results that came back.'
              : 'Check the connection and try again.'
          }
          onRetry={() => void retry()}
        />
      ) : firstSearchInFlight ? (
        // Shaped like the rows it replaces, so the list does not jump when the
        // answer lands. Never shown once anything is on screen — that is the
        // rule T4 exists for.
        <LoadingRows count={6} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<SearchIcon className="h-7 w-7" />}
          title={`Nothing matches “${query}”`}
          description="Check the spelling, or try the last four digits of the family's mobile."
        />
      ) : (
        <>
          <p role="status" className="px-1 text-sm text-muted">
            {showingStale
              ? 'Searching…'
              : list.length === 50
                ? 'First 50 matches'
                : `${list.length} ${list.length === 1 ? 'match' : 'matches'}`}
          </p>

          {/* The staleness is VISIBLE, which is what makes showing the previous
              term's rows honest. `aria-busy` says the same thing to a screen
              reader that the opacity says to the eye. */}
          <div
            className={cn(
              'overflow-hidden rounded-2xl border border-rule-strong bg-surface transition-opacity duration-press ease-ledger',
              showingStale && 'opacity-60',
            )}
            role="list"
            aria-label="Search results"
            aria-busy={showingStale || undefined}
          >
            {list.map((row, index) => (
              <div key={row.profile.guest_id ?? `${row.profile.guest_name}|${index}`} role="listitem">
                <GuestResultRow
                  guest={row.profile}
                  term={query}
                  onPress={() => setOpenIndex(index)}
                />
              </div>
            ))}
          </div>
        </>
      )}

      <GuestSheet
        guest={(open?.profile as GuestSheetData | undefined) ?? null}
        open={open !== null}
        onClose={() => setOpenIndex(null)}
        // A result can open the family's record only when BOTH are true: the
        // read that found it knew the family id (the phone/name RPC does, the
        // view's room match does not) AND this viewer may open the record.
        // A row with no id, or a viewer the RSVP guard would bounce, opens the
        // sheet without the button rather than linking to a dead end.
        familyHref={
          canOpenFamilyRecord && open?.groupId
            ? `/${eventCode}/rsvp/status/${open.groupId}`
            : null
        }
      />
    </div>
  )
}

export default StaffGuestDirectory
