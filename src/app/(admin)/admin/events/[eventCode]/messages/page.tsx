import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { resolveEventByCode } from '@/lib/supabase/queries'
import { ManualSendClient } from './ManualSendClient'

export const metadata: Metadata = {
  title: 'Prepare messages',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
}

export function generateStaticParams(): Array<Record<string, string>> {
  return [{}]
}

export default async function ManualSendPage({ params }: PageProps) {
  const { eventCode } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  return <ManualSendClient eventId={event.id} eventCode={event.code} />
}
