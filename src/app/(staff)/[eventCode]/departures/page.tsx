import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { resolveEventByCode, requireStaff } from '@/lib/supabase/queries'
import { DeparturesClient } from './DeparturesClient'

export const metadata: Metadata = {
  title: 'Departures',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
}

export default async function DeparturesPage({ params }: PageProps) {
  const { eventCode } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  await requireStaff(event.id, event.code)

  return <DeparturesClient eventId={event.id} eventCode={event.code} />
}
