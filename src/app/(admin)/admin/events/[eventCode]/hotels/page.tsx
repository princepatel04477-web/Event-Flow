import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { resolveEventByCode } from '@/lib/supabase/queries'
import { HotelListClient } from './_components/HotelListClient'

export const metadata: Metadata = { title: 'Hotels' }

type PageProps = { params: Promise<{ eventCode: string }> }

export default async function HotelsPage({ params }: PageProps) {
  const { eventCode } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  return <HotelListClient eventId={event.id} eventCode={event.code} />
}
