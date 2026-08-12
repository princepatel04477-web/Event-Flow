import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { requireStaff, resolveEventByCode } from '@/lib/supabase/queries'
import { UnmatchedTrayClient } from './UnmatchedTrayClient'

export const metadata: Metadata = {
  title: 'Unmatched recordings',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
}

/**
 * /[eventCode]/calls/unmatched — recordings the auto-match could not place.
 *
 * Shows every ledger entry with status 'unmatched' and lets staff manually
 * attach each one to a guest group. This is a normal outcome, not an error —
 * the tray must not look like a failure state.
 */
export function generateStaticParams(): Array<Record<string, string>> {
  return []
}

export default async function UnmatchedTrayPage({ params }: PageProps) {
  const { eventCode } = await params

  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  await requireStaff(event.id, event.code)

  // Fetch the list of groups for the manual-attach picker.
  const supabase = await createClient()
  const { data: groups } = await supabase
    .from('guest_groups')
    .select('id, head_name, primary_mobile')
    .eq('event_id', event.id)
    .order('head_name', { ascending: true })

  return (
    <UnmatchedTrayClient
      eventId={event.id}
      eventCode={event.code}
      groups={groups ?? []}
    />
  )
}
