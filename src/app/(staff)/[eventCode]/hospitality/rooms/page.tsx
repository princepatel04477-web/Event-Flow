import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import type { TabAccess } from '@/components/nav/BottomTabs'

import { resolveEventByCode, requireStaff, getEventAccess } from '@/lib/supabase/queries'

import { RoomsGridClient } from './RoomsGridClient'

export const metadata: Metadata = {
  title: 'Rooms',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
}

export function generateStaticParams(): Array<Record<string, string>> {
  return []
}

export default async function RoomsPage({ params }: PageProps) {
  const { eventCode } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  await requireStaff(event.id, event.code)
  const access = await getEventAccess(event.id)
  const tabAccess: TabAccess = access === 'client' ? 'client' : access === 'none' ? 'client' : access

  return <RoomsGridClient eventId={event.id} eventCode={event.code} access={tabAccess} />
}
