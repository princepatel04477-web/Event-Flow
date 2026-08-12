import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { resolveEventByCode } from '@/lib/supabase/queries'
import { TemplatesClient } from './TemplatesClient'

export const metadata: Metadata = {
  title: 'Message templates',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
}

export function generateStaticParams(): Array<Record<string, string>> {
  return []
}

export default async function TemplatesPage({ params }: PageProps) {
  const { eventCode } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  return <TemplatesClient eventId={event.id} />
}
