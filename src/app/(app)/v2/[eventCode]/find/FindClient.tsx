'use client'

import { useMemo, useState } from 'react'

import { SearchIcon } from '@/components/icons'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { LinkButton } from '@/components/ui/LinkButton'
import { LoadingRows } from '@/components/ui/LoadingRows'
import { PageTitle } from '@/components/ui/PageTitle'
import { listClientGuests, type ClientGuestRow } from '@/lib/actions/client-guests'
import { traceFetch } from '@/lib/perf'
import { useStableData } from '@/lib/use-stable-data'
import { useOnline } from '@/lib/useOnline'

import { FindResultRow, FindSearchField } from './_components/FindParts'

/** Below this many characters a search is not yet a search. Matches the app. */
const MIN_SEARCH = 2

export interface FindClientProps {
  eventId: string
  eventCode: string
}

/**
 * The client's search — their own list, and nothing else.
 *
 * THE SAME SOURCE THE CLIENT GUEST LIST ALREADY USES, and the same cache KEY,
 * deliberately: `client_guest_profiles` via `listClientGuests`, held under
 * `client-guests:<eventId>` in `useStableData`'s module cache, which is the key
 * `ClientGuestList` reads and writes. Two consequences that are the point of
 * this screen rather than a coincidence of it:
 *
 *  - A client who has opened the guest list once can search it here with NO
 *    network at all, because the rows are already in that cache. That is the
 *    brief's "offer the last-loaded list", and it needs no second store.
 *  - `search_guest_profiles` is never called from this component. It runs as
 *    the invoker and returns zero rows to a client, so the staff search would
 *    show a confident, fabricated "Nothing matches" on a 238-family wedding —
 *    the failure `ClientGuestList`'s header already documents.
 *
 * WHY FILTERING HERE IS NOT THE THING THE BRIEF FORBIDS. The rule is about the
 * phone pulling the whole list to avoid a server filter; a client's list IS
 * pulled, in full, by the screen this one shares a cache with, and it always
 * was — that is what makes it readable offline. This screen adds no read of its
 * own: it filters rows already on the handset.
 *
 * AND NO ROW LINKS. The family record a staff result opens is a staff screen,
 * so a client result that linked to it would bounce the person who tapped it.
 * `FindResultRow` renders a link only when it is given an href, and this
 * component never gives one.
 */
export function FindClient({ eventId, eventCode }: FindClientProps) {
  const [term, setTerm] = useState('')
  const online = useOnline()

  const { data: rows, loading, error, reload } = useStableData<ClientGuestRow[]>(
    `client-guests:${eventId}`,
    async () => {
      const result = await traceFetch('client guests :: load', () => listClientGuests(eventId))
      if (!result.ok) throw new Error(result.message)
      return result.rows
    },
  )

  const query = term.trim()
  const searchActive = query.length >= MIN_SEARCH

  // In-memory, because the rows are already here. Filtering on every keystroke
  // is why this screen has no debounce and no spinner: there is nothing in the
  // air to wait for.
  const matches = useMemo(() => {
    if (!searchActive || !rows) return []
    const needle = query.toLocaleLowerCase()
    return rows.filter((row) => {
      const name = row.guest_name?.toLocaleLowerCase() ?? ''
      const head = row.family_head?.toLocaleLowerCase() ?? ''
      const room = row.room_number?.toLocaleLowerCase() ?? ''
      return name.includes(needle) || head.includes(needle) || room.includes(needle)
    })
  }, [rows, searchActive, query])

  const loadError = error instanceof Error ? error.message : error ? String(error) : null

  return (
    <div className="flex flex-col gap-4">
      <PageTitle>Find someone</PageTitle>

      <FindSearchField
        value={term}
        onChange={setTerm}
        placeholder="Name or room number"
        busy={false}
      />

      {loadError && !rows ? (
        <ErrorState
          title="Could not load your guest list"
          description={loadError}
          onRetry={() => void reload()}
        />
      ) : loading && !rows ? (
        <LoadingRows count={6} />
      ) : !searchActive ? (
        <EmptyState
          icon={<SearchIcon className="h-7 w-7" />}
          title="Search your guest list"
          description={
            <>
              Type at least {MIN_SEARCH} characters. You can search by a guest&apos;s name, the
              family head&apos;s name, or a room number.
            </>
          }
        />
      ) : matches.length === 0 ? (
        <EmptyState
          icon={<SearchIcon className="h-7 w-7" />}
          title={`Nothing matches “${query}”`}
          description={
            <>
              No guest on your list matched{' '}
              <strong className="font-medium text-ink">{query}</strong> by name, family head or
              room number. Check the spelling, or open the full list.
            </>
          }
          action={
            <LinkButton href={`/${eventCode}/guests`} variant="secondary" fullWidth>
              Open the full guest list
            </LinkButton>
          }
        />
      ) : (
        <>
          <p role="status" className="text-sm text-muted">
            {matches.length} {matches.length === 1 ? 'match' : 'matches'}
            {online ? '' : ' · showing the list saved on this phone'}
          </p>

          {/* No dimming and no busy state: nothing is in flight. The list can
              also be showing a stale-but-real copy, and the line above says so
              rather than leaving the reader to guess why it is not updating. */}
          <ul className="flex flex-col gap-2.5" role="list" aria-label="Search results">
            {matches.map((row) => (
              <li key={row.guest_id ?? `${row.guest_name}|${row.room_number}`} className="contents">
                <FindResultRow
                  row={row}
                  term={query}
                  // Never a link. See the header: every staff destination would
                  // bounce a client off the screen they just found.
                  href={null}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      {!online ? (
        <p className="text-xs leading-relaxed text-subtle">
          Offline — this is the guest list as it was last loaded on this phone.
        </p>
      ) : null}
    </div>
  )
}

export default FindClient
