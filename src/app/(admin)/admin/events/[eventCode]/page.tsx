import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { resolveEventByCode } from '@/lib/supabase/queries'
import { DashboardClient } from './DashboardClient'

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

  return <DashboardClient eventId={event.id} eventCode={event.code} />
}
