import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { requireStaff, resolveEventByCode } from '@/lib/supabase/queries'

import { GuestsClient } from './GuestsClient'

export const metadata: Metadata = {
  title: 'Guest list',
}

type PageProps = {
  // Next 15+ hands params over as a Promise.
  params: Promise<{ eventCode: string }>
}

/**
 * The guest list is now a windowed (virtualised) client list with
 * server-side search — see GuestsClient for why. This page resolves the
 * event, gates staff, and hands the client the event ids it needs. The
 * full row set is fetched client-side through the module-cached
 * useStableData hook, so a returning tab renders from cache.
 */
export default async function GuestsPage({ params }: PageProps) {
  const { eventCode } = await params

  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  await requireStaff(event.id, event.code)

  return <GuestsClient eventId={event.id} eventCode={event.code} />
}
