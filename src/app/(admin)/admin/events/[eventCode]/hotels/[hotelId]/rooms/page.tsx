import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { resolveEventByCode } from '@/lib/supabase/queries'
import { RoomCreateForm } from './_components/RoomCreateForm'

export const metadata: Metadata = { title: 'Add rooms' }

type PageProps = { params: Promise<{ eventCode: string; hotelId: string }> }

export function generateStaticParams(): Array<Record<string, string>> {
  return []
}

export default async function RoomCreatePage({ params }: PageProps) {
  const { eventCode, hotelId } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  const supabase = await createClient()
  const { data: hotel } = await supabase.from('hotels').select('name').eq('id', hotelId).eq('event_id', event.id).single()
  if (!hotel) notFound()

  return <RoomCreateForm eventId={event.id} hotelId={hotelId} eventCode={event.code} hotelName={hotel.name} />
}
