import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { readHotelImportContext } from '@/lib/actions/import-hotels'
import { resolveEventByCode } from '@/lib/supabase/queries'
import { HotelImporter } from '../HotelImporter'

export const metadata: Metadata = { title: 'Import hotels' }

type PageProps = { params: Promise<{ eventCode: string }> }

export function generateStaticParams(): Array<Record<string, string>> {
  return [{}]
}

export default async function ImportHotelsPage({ params }: PageProps) {
  const { eventCode } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  const ctx = await readHotelImportContext(event.id)

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-xl font-medium tracking-[0.14em] uppercase">Import hotels</h1>
      {ctx.ok ? (
        <p className="text-sm text-muted">
          {ctx.existingHotels} hotel{ctx.existingHotels === 1 ? '' : 's'},{' '}
          {ctx.existingRooms} room{ctx.existingRooms === 1 ? '' : 's'} already on file.
        </p>
      ) : null}
      <HotelImporter eventId={event.id} eventCode={event.code} context={ctx} />
    </div>
  )
}
