import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'

import { createClient } from '@/lib/supabase/server'
import { resolveEventByCode } from '@/lib/supabase/queries'
import { DashboardClient } from './DashboardClient'
import { ArchiveEventCard } from './ArchiveEventCard'
import { readHotelImportContext } from '@/lib/actions/import-hotels'
import { BuildingIcon, ChevronRightIcon, UsersIcon } from '@/components/icons'
import { Card } from '@/components/ui/Card'
import { Row } from '@/components/ui/Row'

export const metadata: Metadata = { title: 'Dashboard' }

type PageProps = { params: Promise<{ eventCode: string }> }

export default async function AdminEventDashboardPage({ params }: PageProps) {
  const { eventCode } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  const supabase = await createClient()
  const [staffCount, hotelContext] = await Promise.all([
    supabase
      .from('staff_members')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', event.id)
      .then(r => r.count),
    readHotelImportContext(event.id),
  ])

  return (
    <div className="flex flex-col gap-8">
      {staffCount === 0 ? (
        // Advisory since migration 20260814140000. This used to say nothing
        // could be saved without a staff name, which was true while every
        // insert policy ANDed `app.has_staff_identity`. That gate is gone, so
        // the old wording would now be a false alarm — and a warning that
        // cries wolf is worse than none, because the next real one is ignored.
        <Link
          href={`/admin/events/${event.code}/staff`}
          className="tap block rounded-xl border border-ledger-amber/40 bg-amber-tint px-4 py-3 text-sm font-medium text-ledger-amber"
        >
          No staff names yet — calls and photos will be recorded against nobody.
        </Link>
      ) : null}

      <DashboardClient eventId={event.id} eventCode={event.code} />

      {/* Two ways out of the dashboard, in the register's own row shape: a
          40px glyph, a name, one muted meta line, and the whole row is the
          tap target. */}
      <Card>
        <Link
          href={`/admin/events/${event.code}/staff`}
          className="tap block border-b border-rule last:border-b-0"
        >
          <Row
            heading="Staff"
            meta={`${staffCount === 1 ? '1 person' : `${staffCount ?? 0} people`} can log calls and save data`}
            badge={
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-tint text-brand">
                <UsersIcon className="h-5 w-5" />
              </span>
            }
            trailing={<ChevronRightIcon className="h-5 w-5" aria-hidden />}
          />
        </Link>

        <Link
          href={`/admin/events/${event.code}/hotels`}
          className="tap block border-b border-rule last:border-b-0"
        >
          <Row
            heading="Hotels & rooms"
            meta={
              hotelContext.ok
                ? `${hotelContext.existingHotels} hotel${hotelContext.existingHotels === 1 ? '' : 's'} · ${hotelContext.existingRooms} room${hotelContext.existingRooms === 1 ? '' : 's'}`
                : 'Imported from a sheet'
            }
            badge={
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-tint text-brand">
                <BuildingIcon className="h-5 w-5" />
              </span>
            }
            trailing={<ChevronRightIcon className="h-5 w-5" aria-hidden />}
          />
        </Link>
      </Card>

      {/* Last on the page, deliberately. Nothing routine lives below it, so
          the archive control is never something a thumb passes over on the
          way to a task. */}
      <ArchiveEventCard
        eventId={event.id}
        eventName={event.name}
        eventCode={event.code}
        archivedAt={event.archived_at}
      />
    </div>
  )
}
