import Link from 'next/link'
import type { Metadata } from 'next'

import { CalendarIcon, ChevronLeftIcon } from '@/components/icons'
import { Badge } from '@/components/ui/Badge'
import { Card, CardBody } from '@/components/ui/Card'
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
  'id' | 'name' | 'code' | 'bride_name' | 'groom_name' | 'starts_on' | 'ends_on' | 'is_active'
>

const EVENT_COLUMNS =
  'id, name, code, bride_name, groom_name, starts_on, ends_on, is_active'

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
export default async function AdminEventsPage() {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('events')
    .select(EVENT_COLUMNS)
    .order('created_at', { ascending: false })

  const events: EventRow[] = data ?? []

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

        {error ? (
          // Say nothing about how many events exist — we did not find out.
          <p
            role="alert"
            className="rounded-xl border border-danger bg-tint-danger px-4 py-3 text-base font-medium text-danger"
          >
            Could not load the event list. {friendlyDbError(error)}
          </p>
        ) : events.length === 0 ? (
          <EmptyState
            icon={<CalendarIcon className="h-7 w-7" />}
            title="No events yet"
            description="Nothing has been created on this database. Fill in the form below to make the first one — you will land on its dashboard, ready to import the calling list."
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

      {!error && events.length > 0 ? (
        <section aria-labelledby="tools-heading" className="flex flex-col gap-3">
          <h2 id="tools-heading" className="text-lg font-semibold text-fg">
            Tools
          </h2>

          <Link href="/admin/hotels" className="block">
            <Card className="transition-colors hover:bg-surface-2 active:bg-surface-2">
              <CardBody className="py-3">
                <p className="font-semibold text-fg">Hotels and rooms</p>
                <p className="mt-0.5 text-sm text-muted">
                  Set up hotels, add rooms in bulk, and recover allocations from the imported
                  sheet.
                </p>
              </CardBody>
            </Card>
          </Link>

          <Link href="/admin/rooms" className="block">
            <Card className="transition-colors hover:bg-surface-2 active:bg-surface-2">
              <CardBody className="py-3">
                <p className="font-semibold text-fg">Room grid and allocation</p>
                <p className="mt-0.5 text-sm text-muted">
                  Propose an allocation, then move, place and release guests room by room.
                </p>
              </CardBody>
            </Card>
          </Link>

          <Link href="/admin/export" className="block">
            <Card className="transition-colors hover:bg-surface-2 active:bg-surface-2">
              <CardBody className="py-3">
                <p className="font-semibold text-fg">Download to Excel</p>
                <p className="mt-0.5 text-sm text-muted">
                  Guests, families, arrivals and departures — one workbook, ready to hand to a
                  desk.
                </p>
              </CardBody>
            </Card>
          </Link>
        </section>
      ) : null}

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
