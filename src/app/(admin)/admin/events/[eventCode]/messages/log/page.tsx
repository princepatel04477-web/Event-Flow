import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { resolveEventByCode } from '@/lib/supabase/queries'
import { LogClient } from './LogClient'

export const metadata: Metadata = {
  title: 'Message log',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
}

export default async function LogPage({ params }: PageProps) {
  const { eventCode } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  return <LogClient eventId={event.id} />
}
