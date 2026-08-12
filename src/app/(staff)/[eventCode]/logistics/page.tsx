import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { resolveEventByCode, requireStaff } from '@/lib/supabase/queries'
import { LogisticsClient } from './LogisticsClient'

export const metadata: Metadata = {
  title: 'Logistics',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
}

export function generateStaticParams(): Array<Record<string, string>> {
  return []
}

export default async function LogisticsPage({ params }: PageProps) {
  const { eventCode } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  await requireStaff(event.id, event.code)

  return <LogisticsClient eventId={event.id} />
}
