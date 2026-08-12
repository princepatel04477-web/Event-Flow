import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { resolveEventByCode } from '@/lib/supabase/queries'
import { SendClient } from '../SendClient'

export const metadata: Metadata = {
  title: 'Send messages',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
}

/**
 * Bulk send via the WhatsApp provider (API). The manual path lives at
 * /messages (prepare → copy / download); this one hands the job to
 * sendMessages() and writes the messages table with provider status.
 */
export function generateStaticParams(): Array<Record<string, string>> {
  return [{}]
}

export default async function SendPage({ params }: PageProps) {
  const { eventCode } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  return <SendClient eventId={event.id} eventCode={event.code} />
}
