import Link from 'next/link'
import type { Metadata } from 'next'

import { CalendarIcon, ChevronLeftIcon } from '@/components/icons'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { friendlyDbError } from '@/lib/errors'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/database.types'
import { formatDateRange } from '@/lib/utils'

import { CreateEventForm } from './CreateEventForm'

export const metadata: Metadata = {
  title: 'Events',
}

type EventRow = Pick<
  Database['public']['Tables']['events']['Row'],
  | 'id'
  | 'name'
  | 'code'
  | 'bride_name'
  | 'groom_name'
  | 'starts_on'
  | 'ends_on'
  | 'is_active'
  | 'archived_at'
>

const EVENT_COLUMNS =
  'id, name, code, bride_name, groom_name, starts_on, ends_on, is_active, archived_at'

/**
 * /admin/events — every event, and the form that adds one.
 *
 * ROUTE COLLISION, accepted: `/admin` is a literal static segment and Next
 * resolves static before dynamic, so it shadows `/[eventCode]`. An event
 * whose code were literally "ADMIN" would be unreachable at its own URL. The
 * create form uppercases codes, so "admin" and "ADMIN" are the same value;
 * nothing stops one being created, and if one ever is, rename it.
 *
 * The layout has already established that the viewer is an admin. That
 * matters for reading this list honestly: RLS on `events` is
 * `select using app.is_member(id)`, which is true on every row for an admin —
 * so zero rows here genuinely means no events exist, rather than "you cannot
 * see them". For anybody else that inference would be false, which is exactly
 * why the guard is in the layout and not in a client component.
 */
type PageProps = {
  // Next 15+ hands searchParams over as a Promise.
  searchParams: Promise<{ archived?: string }>
}

export default async function AdminEventsPage({ searchParams }: PageProps) {
  const { archived } = await searchParams
  const showArchived = archived === '1'

  const supabase = await createClient()

  // Always read both, and filter in TypeScript rather than with `.is()`. The
  // count of hidden events is what makes the toggle discoverable — a filter
  // applied in the query would leave the page unable to say "2 archived"
  // without a second round trip.
  const { data, error } = await supabase
    .from('events')
    .select(EVENT_COLUMNS)
    .order('created_at', { ascending: false })

  const allEvents: EventRow[] = data ?? []
  const events: EventRow[] = showArchived
    ? allEvents
    : allEvents.filter((e) => e.archived_at === null)
  const archivedCount = allEvents.filter((e) => e.archived_at !== null).length

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="events-heading" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="events-heading" className="text-lg font-semibold text-fg">
            Events
          </h2>
          {!error && events.length > 0 ? (
            <span className="text-sm text-muted">
              {events.length === 1 ? '1 event' : `${events.length} events`}
            </span>
          ) : null}
        </div>

        {/* Only rendered when something is actually hidden. A permanent
            "show archived" control on a database with nothing archived is a
            question nobody asked. */}
        {!error && archivedCount > 0 ? (
          <Link
            href={showArchived ? '/admin/events' : '/admin/events?archived=1'}
            className="tap self-start text-sm font-medium text-brand underline"
          >
            {showArchived
              ? 'Hide archived events'
              : `Show ${archivedCount} archived event${archivedCount === 1 ? '' : 's'}`}
          </Link>
        ) : null}

        {error ? (
          // Say nothing about how many events exist — we did not find out.
          <p
            role="alert"
            className="rounded-xl border border-danger bg-tint-danger px-4 py-3 text-base font-medium text-danger"
          >
            Could not load the event list. {friendlyDbError(error)}
          </p>
        ) : events.length === 0 ? (
          // Two genuinely different situations, and saying the wrong one is a
          // lie about the database: an admin who has archived everything is
          // told nothing exists, and goes looking for data that is still there.
          <EmptyState
            icon={<CalendarIcon className="h-7 w-7" />}
            title={archivedCount > 0 ? 'Every event is archived' : 'No events yet'}
            description={
              archivedCount > 0
                ? `All ${archivedCount} event${archivedCount === 1 ? '' : 's'} on this database ${archivedCount === 1 ? 'is' : 'are'} archived. Nothing has been deleted — use the link above to see them, or create a new one below.`
                : 'Nothing has been created on this database. Fill in the form below to make the first one — you will land on its dashboard, ready to import the calling list.'
            }
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {events.map((event) => (
              <li key={event.id}>
                <EventRowCard event={event} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/*
        The "Tools" section that used to sit here linked /admin/hotels,
        /admin/rooms and /admin/export. All three routes were deleted when
        those screens moved to per-event paths, and the links were left
        behind — every one of them returned a hard 404 in production, and the
        RSC prefetch for the first logged an error on every visit to this page.

        Repointing them was not possible: all three tools are scoped to one
        event, and this page lists every event without selecting one. There is
        no correct href from here. The working routes are reached from the
        event you are actually working on —
        /admin/events/{code}/hotels in the sidebar, and rooms and export from
        the staff nav — so nothing is lost by removing the section.
      */}
      <section aria-labelledby="create-heading" className="flex flex-col gap-4">
        <div>
          <h2 id="create-heading" className="text-lg font-semibold text-fg">
            Create an event
          </h2>
          <p className="mt-1 text-sm text-muted">
            One wedding, one event. Everything else — guests, rooms, hampers, vehicles —
            hangs off it and is fenced to it.
          </p>
        </div>

        <CreateEventForm />
      </section>
    </div>
  )
}

function EventRowCard({ event }: { event: EventRow }) {
  const dates = formatDateRange(event.starts_on, event.ends_on)
  const couple = [event.bride_name, event.groom_name].filter(Boolean).join(' & ')

  return (
    <Card className="transition-colors hover:bg-surface-2">
      <Link
        href={`/admin/events/${event.code}`}
        className="tap flex min-h-16 items-center gap-3 px-4 py-3"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-lg font-semibold text-fg">
            {event.name}
          </span>

          {couple ? (
            <span className="mt-0.5 block truncate text-sm text-muted">{couple}</span>
          ) : null}

          <span className="mt-1.5 flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{event.code}</Badge>
            {event.archived_at ? <Badge tone="neutral">Archived</Badge> : null}
            {event.is_active ? null : <Badge tone="warning">Inactive</Badge>}
            {dates ? (
              <span className="truncate text-sm text-muted">{dates}</span>
            ) : (
              // starts_on is nullable in the database; the form makes it
              // mandatory, so a blank one predates this screen or was written
              // by hand. Flag it — the Excel import cannot run without it.
              <Badge tone="warning">No dates</Badge>
            )}
          </span>
        </span>

        <ChevronLeftIcon className="h-6 w-6 shrink-0 rotate-180 text-muted" aria-hidden />
      </Link>
    </Card>
  )
}
