import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { resolveEventByCode } from '@/lib/supabase/queries'
import { createClient } from '@/lib/supabase/server'
import { LedgerClient } from './LedgerClient'

export const metadata: Metadata = {
  title: 'Travel ledger',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
}

export default async function LedgerPage({ params }: PageProps) {
  const { eventCode } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  // Admin guard: the parent layout already checks isAdmin, but resolve event
  // here for the event context the page needs.

  return <LedgerClient eventId={event.id} eventCode={event.code} eventName={event.name} />
}
