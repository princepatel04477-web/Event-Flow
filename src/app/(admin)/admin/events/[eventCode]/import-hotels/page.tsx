import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { AdminPageTitle } from '@/app/(admin)/AdminPageTitle'
import { readHotelImportContext } from '@/lib/actions/import-hotels'
import { resolveEventByCode } from '@/lib/supabase/queries'
import { HotelImporter } from '../HotelImporter'

export const metadata: Metadata = { title: 'Import hotels' }

type PageProps = { params: Promise<{ eventCode: string }> }

export default async function ImportHotelsPage({ params }: PageProps) {
  const { eventCode } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  const ctx = await readHotelImportContext(event.id)

  return (
    <div className="flex flex-col gap-6">
      <AdminPageTitle
        context={
          ctx.ok
            ? `${ctx.existingHotels} hotel${ctx.existingHotels === 1 ? '' : 's'} · ${ctx.existingRooms} room${ctx.existingRooms === 1 ? '' : 's'} on file`
            : undefined
        }
      >
        Import hotels
      </AdminPageTitle>

      <HotelImporter eventId={event.id} eventCode={event.code} context={ctx} />
    </div>
  )
}
