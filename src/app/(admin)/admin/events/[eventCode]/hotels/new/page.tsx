import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { resolveEventByCode } from '@/lib/supabase/queries'
import { HotelCreateForm } from './_components/HotelCreateForm'

export const metadata: Metadata = { title: 'New hotel' }

type PageProps = { params: Promise<{ eventCode: string }> }

export function generateStaticParams(): Array<Record<string, string>> {
  return [{}]
}

export default async function NewHotelPage({ params }: PageProps) {
  const { eventCode } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()
  return <HotelCreateForm eventId={event.id} eventCode={event.code} />
}
