import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { resolveEventByCode } from '@/lib/supabase/queries'
import { DashboardClient } from './DashboardClient'
import { HotelImporter } from './HotelImporter'
import { readHotelImportContext } from '@/lib/actions/import-hotels'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { BuildingIcon, UploadIcon } from '@/components/icons'

export const metadata: Metadata = {
  title: 'Dashboard',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
}

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
      .then((r) => r.count),
    readHotelImportContext(event.id),
  ])

  return (
    <div className="flex flex-col gap-8">
      {staffCount === 0 ? (
        <div className="rounded-xl bg-tint-warning px-4 py-3 text-sm font-medium text-warning">
          No staff members on this event. Nobody can log in — add at least one name.
        </div>
      ) : null}

      <DashboardClient eventId={event.id} eventCode={event.code} />

      <div className="flex flex-col gap-4 rounded-2xl border border-rule bg-surface-2 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-fg">Import hotels</h3>
            <p className="text-sm text-muted">
              Upload a CSV or Excel file to bulk-add hotels and rooms for this event.
            </p>
            {hotelContext.ok ? (
              <p className="mt-1 text-xs text-subtle">
                {hotelContext.existingHotels} hotel{hotelContext.existingHotels === 1 ? '' : 's'},{' '}
                {hotelContext.existingRooms} room{hotelContext.existingRooms === 1 ? '' : 's'} already on file.
              </p>
            ) : null}
          </div>
        </div>
        <HotelImporter eventId={event.id} eventCode={event.code} context={hotelContext} />
      </div>
    </div>
  )
}
