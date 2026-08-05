import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { resolveEventByCode, requireStaff } from '@/lib/supabase/queries'

import { RoomsGridClient } from './RoomsGridClient'

export const metadata: Metadata = {
  title: 'Rooms',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
}

export default async function RoomsPage({ params }: PageProps) {
  const { eventCode } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  await requireStaff(event.id, event.code)

  return <RoomsGridClient eventId={event.id} />
}
