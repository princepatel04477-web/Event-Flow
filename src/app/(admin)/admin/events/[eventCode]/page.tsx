import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'

import { createClient } from '@/lib/supabase/server'
import { resolveEventByCode } from '@/lib/supabase/queries'
import { DashboardClient } from './DashboardClient'
import { readHotelImportContext } from '@/lib/actions/import-hotels'
import { BuildingIcon, UsersIcon } from '@/components/icons'

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
          className="tap block rounded-xl bg-tint-warning px-4 py-3 text-sm font-medium text-warning underline"
        >
          No staff names on this event. Everything still works, but calls,
          photos and room changes will be recorded against nobody.
        </Link>
      ) : null}

      <DashboardClient eventId={event.id} eventCode={event.code} />

      <Link
        href={`/admin/events/${event.code}/staff`}
        className="tap flex items-center gap-4 rounded-2xl border border-rule bg-surface p-4 transition-colors hover:bg-surface-2 active:bg-surface-2"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-tint text-brand">
          <UsersIcon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-fg">Staff</p>
          <p className="text-sm text-muted">
            {staffCount === 1 ? '1 person' : `${staffCount ?? 0} people`} can log calls and
            save data
          </p>
        </div>
      </Link>

      <Link
        href={`/admin/events/${event.code}/hotels`}
        className="tap flex items-center gap-4 rounded-2xl border border-rule bg-surface p-4 transition-colors hover:bg-surface-2 active:bg-surface-2"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-tint text-brand">
          <BuildingIcon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold text-fg">Hotels &amp; Rooms</p>
          {hotelContext.ok ? (
            <p className="text-sm text-muted">
              {hotelContext.existingHotels} hotel{hotelContext.existingHotels === 1 ? '' : 's'},{' '}
              {hotelContext.existingRooms} room{hotelContext.existingRooms === 1 ? '' : 's'}
            </p>
          ) : null}
        </div>
      </Link>
    </div>
  )
}
