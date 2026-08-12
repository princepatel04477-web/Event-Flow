import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { resolveEventByCode } from '@/lib/supabase/queries'
import { HotelDetailClient } from './_components/HotelDetailClient'

export const metadata: Metadata = { title: 'Hotel' }

type PageProps = { params: Promise<{ eventCode: string; hotelId: string }> }

export function generateStaticParams(): Array<Record<string, string>> {
  return []
}

export default async function HotelDetailPage({ params }: PageProps) {
  const { eventCode, hotelId } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  const supabase = await createClient()
  const { data: hotel } = await supabase
    .from('hotels')
    .select('name, address, contact_name, contact_mobile, notes')
    .eq('id', hotelId)
    .eq('event_id', event.id)
    .single()

  if (!hotel) notFound()

  return (
    <HotelDetailClient
      hotelId={hotelId}
      eventId={event.id}
      eventCode={event.code}
      initial={{ name: hotel.name, address: hotel.address, contactName: hotel.contact_name, contactMobile: hotel.contact_mobile, notes: hotel.notes }}
    />
  )
}
