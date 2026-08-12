'use client'

import { useMemo, useState } from 'react'

import { SearchIcon, UsersIcon } from '@/components/icons'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { listClientGuests, type ClientGuestRow, type ClientDashboardStats } from '@/lib/actions/client-guests'
import { traceFetch } from '@/lib/perf'
import { useStableData } from '@/lib/use-stable-data'

import { FamilySection } from './FamilySection'
import { groupByFamilyHead, groupBySide, rsvpLabel } from './format'

function StatCard({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'red' }) {
  return (
    <div className="rounded-xl border border-rule bg-surface p-3">
      <div className={`text-xl font-semibold leading-none ${tone === 'green' ? 'text-ledger-green' : tone === 'red' ? 'text-ledger-red' : 'text-ink'}`}>{value}</div>
      <div className="mt-1 text-xs text-muted">{label}</div>
    </div>
  )
}

/**
 * The client's guest list — the only screen a `client` login can use.
 *
 * WHY THIS IS NOT THE STAFF LIST: the staff screen next door reads
 * `search_guest_profiles`, which runs as the invoker. A client gets zero rows
 * from it and would be shown a confident, fabricated "No guest details yet"
 * on a wedding with 238 families. This one reads `client_guest_profiles`, and
 * presents it as an itinerary rather than an ops list — see GuestCard.
 *
 * WHY IT RENDERS IN PAGES: the original version of this screen mounted every
 * card at once. The database answered in ~5ms and the WebView then spent 26
 * seconds laying out 543 variable-height cards. The staff list solved that by
 * virtualising fixed-height rows; that trick does not transfer here, because
 * a GuestCard's height depends on how much of the family's travel is known.
 * So the list grows on demand instead: a bounded first paint, and every guest
 * still reachable. Search narrows before it grows, which is what someone
 * looking for one uncle actually does.
 *
 * Filtering is in-memory. The whole set arrives in one read and lives in the
 * module cache, so typing costs nothing and never touches Seoul.
 */

/** Families rendered per page. ~2.3 guests each, so ~35 cards a step. */
const FAMILIES_PER_PAGE = 15

/** Below this many characters a search is not yet a search. */
const MIN_SEARCH = 2

export interface ClientGuestListProps {
  eventId: string
}

export function ClientGuestList({ eventId }: ClientGuestListProps) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const { data: rows, loading, error, reload } = useStableData<ClientGuestRow[]>(
    `client-guests:${eventId}`,
    async () => {
      const result = await traceFetch('client guests :: load', () => listClientGuests(eventId))
      if (!result.ok) throw new Error(result.message)
      return result.rows
    },
  )

  const q = search.trim().toLocaleLowerCase()
  const searchActive = q.length >= MIN_SEARCH

  const allFamilies = useMemo(() => groupByFamilyHead(rows ?? []), [rows])

  const sideSections = useMemo(() => groupBySide(allFamilies), [allFamilies])

  const stats = useMemo((): ClientDashboardStats | null => {
    if (!rows || rows.length === 0) return null
    const confirmed = allFamilies.filter(f => f.guests.some(g => g.rsvp_status === 'confirmed')).length
    const declined = allFamilies.filter(f => f.guests.some(g => g.rsvp_status === 'declined')).length
    const withRoom = new Set(rows.filter(r => r.room_number).map(r => r.family_head?.trim()?.toLowerCase())).size
    const hamper = rows.filter(r => r.hamper_delivered === true).length
    return {
      totalGuests: rows.length,
      totalFamilies: allFamilies.length,
      confirmedFamilies: confirmed,
      declinedFamilies: declined,
      pendingFamilies: allFamilies.length - confirmed - declined,
      familiesWithHotel: new Set(rows.filter(r => r.hotel_name).map(r => r.family_head?.trim()?.toLowerCase())).size,
      familiesWithRoom: withRoom,
      hamperDelivered: hamper,
      returnGiftDelivered: rows.filter(r => r.return_gift_delivered === true).length,
    }
  }, [rows, allFamilies])

  const families = useMemo(() => {
    if (!searchActive) return allFamilies
    return allFamilies.filter(
      (family) =>
        family.head?.toLocaleLowerCase().includes(q) ||
        family.guests.some((g) => g.guest_name?.toLocaleLowerCase().includes(q)),
    )
  }, [allFamilies, searchActive, q])

  const shown = families.slice(0, page * FAMILIES_PER_PAGE)
  const remaining = families.length - shown.length
  const guestCount = rows?.length ?? 0

  const loadError = error instanceof Error ? error.message : error ? String(error) : null

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
    // Shaped like the cards below, so the screen never flashes a false
    // "no guests" while the first read is still in the air.
    return (
      <div className="flex flex-col gap-4" aria-busy>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rounded-2xl border border-rule-strong bg-surface p-4">
            <div className="h-6 w-2/5 rounded bg-rule-strong" />
            <div className="mt-3 h-4 w-3/4 rounded bg-rule" />
            <div className="mt-2 h-4 w-1/2 rounded bg-rule" />
          </div>
        ))}
      </div>
    )
  }

  if (guestCount === 0) {
    return (
      <EmptyState
        icon={<UsersIcon className="h-7 w-7" />}
        title="No guest details yet"
        description="Nothing has been shared on this event yet. Usually that means the guest list has not been imported, or your account is on the event but no guests are linked to it. Ask your event team — nothing has gone wrong."
      />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-display text-2xl leading-tight font-medium text-ink">Guest list</h2>
        <p className="mt-1 text-sm text-muted">
          {guestCount} {guestCount === 1 ? 'guest' : 'guests'} · {allFamilies.length}{' '}
          {allFamilies.length === 1 ? 'family' : 'families'}. Read-only — your event team
          keeps this up to date.
        </p>
      </div>

      {stats ? (
        <div className="grid grid-cols-2 gap-2">
          <StatCard label="Families" value={String(stats.totalFamilies)} />
          <StatCard label="Confirmed" value={String(stats.confirmedFamilies)} tone="green" />
          <StatCard label="Roomed" value={String(stats.familiesWithRoom)} />
          <StatCard label="Declined" value={String(stats.declinedFamilies)} tone="red" />
        </div>
      ) : null}

      <div className="flex items-center gap-2 rounded-xl border border-rule-strong bg-surface px-3">
        <SearchIcon className="h-5 w-5 shrink-0 text-muted" />
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
          placeholder="Search by name"
          aria-label="Search guests"
          className="min-h-12 w-full bg-transparent text-base text-ink placeholder:text-subtle focus:outline-none"
        />
      </div>

      {searchActive ? (
        <p className="text-sm text-muted" role="status">
          {families.length === 0
            ? 'No guest matches that name.'
            : `${families.length} ${families.length === 1 ? 'family' : 'families'} match`}
        </p>
      ) : null}

      {families.length === 0 ? (
        <EmptyState
          icon={<SearchIcon className="h-7 w-7" />}
          title="Nothing matches"
          description="No guest matches that search. Try a different spelling, or part of the family head's name."
        />
      ) : searchActive ? (
        <div className="flex flex-col gap-4">
          {shown.map((family, index) => (
            <FamilySection key={family.key} family={family} index={index} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {sideSections.map(section => (
            <div key={section.label}>
              <h3 className="mb-3 text-sm font-semibold text-muted uppercase tracking-wider">{section.label}</h3>
              <div className="flex flex-col gap-3">
                {section.families.slice(0, page * FAMILIES_PER_PAGE).map((family, index) => (
                  <FamilySection key={family.key} family={family} index={index} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {remaining > 0 ? (
        <Button variant="secondary" fullWidth onClick={() => setPage((p) => p + 1)}>
          Show {Math.min(remaining, FAMILIES_PER_PAGE)} more
          {remaining > FAMILIES_PER_PAGE ? ` of ${remaining}` : ''}
        </Button>
      ) : null}

      <p className="text-xs leading-relaxed text-subtle">
        Travel times and room numbers appear here as soon as the event team records them.
        A blank line means &quot;not shared yet&quot;, not &quot;nothing planned&quot;.
      </p>
    </div>
  )
}

export default ClientGuestList
