'use client'

import { useEffect, useRef, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { SearchIcon, UsersIcon } from '@/components/icons'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { LinkButton } from '@/components/ui/LinkButton'
import { LoadingRows } from '@/components/ui/LoadingRows'
import { PageTitle } from '@/components/ui/PageTitle'
import { queryKeys } from '@/lib/query/keys'
import { findGuests } from '@/lib/query/reads'
import { useOnline } from '@/lib/useOnline'
import { cn } from '@/lib/utils'

import { FindResultRow, FindSearchField } from './_components/FindParts'

/** Below this many characters a search is not yet a search. Matches the app. */
const MIN_SEARCH = 2
/** 250ms, per the brief. Long enough to finish a word, short enough to feel live. */
const DEBOUNCE_MS = 250

export interface FindStaffProps {
  eventId: string
  eventCode: string
}

/**
 * Staff and admin search — the one box that finds anyone.
 *
 * SERVER-SIDE, ONE BOUNDED READ PER TERM. The term goes into the `where` clause
 * (`findGuests` in `src/lib/query/reads.ts`); the guest list is never pulled to
 * the phone to be filtered there, which at 465 guests over venue Wi-Fi is the
 * thing this brief is written to prevent. What comes back is capped at 50 rows.
 *
 * T4 — TYPING NEVER BLANKS THE RESULTS. `placeholderData: keepPreviousData`
 * holds the previous term's rows on screen while the next one is in the air,
 * `isPlaceholderData` marks them, and the list dims rather than disappearing.
 * The spinner in the field is rendered ONLY while there is nothing to show yet,
 * so a 250ms debounce plus a Seoul round trip never reads as a stall.
 *
 * OFFLINE IS A STATE, NOT AN ERROR (T7). When the device says it is offline the
 * query is not fired at all — `networkMode: 'always'` would otherwise attempt
 * it and surface a transport failure as a load error — and the screen says, in
 * one line, that search needs a signal and offers the last-loaded list instead.
 */
export function FindStaff({ eventId, eventCode }: FindStaffProps) {
  const [term, setTerm] = useState('')
  const [debounced, setDebounced] = useState('')
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

  // The state the QUERY is in, which is not the state the KEYBOARD is in. A term
  // is only asked about once the debounce has promoted it, so these two lag by
  // up to 250ms — and the query reads THIS rather than `searchActive`, so the
  // request and the list cannot disagree about what has been asked for.
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
    // T4. The rows on screen may be the PREVIOUS term's while the new one
    // loads. They stay, and the dimming below is what makes showing them
    // honest rather than a lie.
    placeholderData: keepPreviousData,
  })

  // While offline the query is DISABLED, and the offline branch below comes
  // before anything that could render a placeholder for it. That ordering is
  // load-bearing, not stylistic: a disabled query is `pending` forever, so a
  // pending-based skeleton would sit there for as long as the phone stayed
  // offline — the indefinite spinner T7 forbids.
  const offline = !online

  // What is on screen right now. `debounced` is the term the SERVER was last
  // asked for — the current key — so `rows` is that term's answer, held through
  // the next term's fetch by `keepPreviousData` above. Both facts are derivable
  // from the query state, and deriving them is what keeps this honest: there is
  // no second copy of the results to fall out of step with the cache.
  const list = canSearch && rows ? rows : []
  const searchError = error instanceof Error ? error.message : null

  // "What is on screen is not the answer to what is typed." True for the whole
  // debounce window as well as the fetch after it, because `debounced` still
  // names the previous term until the timer promotes the new one. One flag for
  // both, so the screen has a single staleness signal rather than two that can
  // disagree.
  const showingStale = searchActive && (isPlaceholderData || debounced !== query)
  const searching = searchActive && online && (isFetching || debounced !== query)

  // A spinner only for a search with NOTHING to show — the first two characters
  // of a session. The 250ms debounce is not a fetch, and a spinner through it
  // makes a fast screen look slow.
  const firstSearchInFlight = searching && list.length === 0

  async function retry() {
    setDebounced(query)
    await refetch()
  }

  return (
    <div className="flex flex-col gap-4">
      <PageTitle>Find someone</PageTitle>

      <FindSearchField
        value={term}
        onChange={(next) => {
          setTerm(next)
          // The query key is cleared only when the BOX is cleared, not when the
          // term drops under the minimum. That distinction is the whole of
          // "typing never blanks the results": deleting one character off
          // "rakesh" leaves the key naming "rakesh", so the answer to it stays
          // on screen (dimmed) instead of vanishing while the runner is still
          // typing. `rows` and `debounced` therefore never disagree about what
          // was last asked for — there is no second copy of the results to keep
          // in step.
          if (next.trim().length === 0) setDebounced('')
        }}
        placeholder="Name, last 4 digits, or room"
        busy={firstSearchInFlight}
      />

      {!searchActive ? (
        <EmptyState
          icon={<SearchIcon className="h-7 w-7" />}
          title="Search the guest list"
          description={
            <>
              Type at least {MIN_SEARCH} characters. You can search by a guest&apos;s name,
              the family head&apos;s name, the <strong className="font-medium text-ink">last
              four digits</strong> of the family&apos;s mobile, or a room number.
            </>
          }
        />
      ) : offline ? (
        <EmptyState
          icon={<UsersIcon className="h-7 w-7" />}
          title="Search needs a signal"
          description="The phone is offline, so nothing can be looked up right now. Open the guest list to read the last list that loaded. Anything already saved will send itself when the signal comes back."
          action={
            <LinkButton href={`/${eventCode}/guests/list`} variant="secondary" fullWidth>
              Open the guest list
            </LinkButton>
          }
        />
      ) : searchError ? (
        <ErrorState
          title="Search did not answer"
          description={
            rows
              ? 'Showing the last results that came back. Check the connection and try again.'
              : 'The database did not answer this search. Check the connection and try again, and tell your admin if it keeps happening.'
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
          description={
            <>
              No guest matched <strong className="font-medium text-ink">{query}</strong> by
              name, family head, the last four digits of a mobile, or a room number. Check the
              spelling, or the guest list itself.
            </>
          }
          action={
            <LinkButton href={`/${eventCode}/guests/list`} variant="secondary" fullWidth>
              Open the full guest list
            </LinkButton>
          }
        />
      ) : (
        <>
          <p role="status" className="text-sm text-muted">
            {showingStale
              ? 'Searching…'
              : list.length === 50
                ? 'First 50 matches'
                : `${list.length} ${list.length === 1 ? 'match' : 'matches'}`}
          </p>

          {/* The staleness is VISIBLE, which is what makes showing the previous
              term's rows honest. `aria-busy` says the same thing to a screen
              reader that the opacity says to the eye. */}
          <ul
            className={cn(
              'flex flex-col gap-2.5 transition-opacity duration-press ease-ledger',
              showingStale && 'opacity-60',
            )}
            role="list"
            aria-label="Search results"
            aria-busy={showingStale || undefined}
          >
            {list.map((row) => (
              <li
                key={row.profile.guest_id ?? `${row.profile.guest_name}|${row.profile.room_number}`}
                className="contents"
              >
                <FindResultRow
                  row={row.profile}
                  term={query}
                  // A result can open the family's record only when the read
                  // that found it knew the family id — the phone/name RPC does,
                  // the view's room match does not. A row without one renders
                  // read-only rather than linking to an empty path segment.
                  href={row.groupId ? `/${eventCode}/rsvp/status/${row.groupId}` : null}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

export default FindStaff
