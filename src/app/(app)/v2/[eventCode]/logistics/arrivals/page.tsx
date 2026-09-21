import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { requireSection } from '@/lib/auth/section-guard'
import { resolveEventByCode } from '@/lib/supabase/queries'

import { MeetArrivals } from './MeetArrivals'

export const metadata: Metadata = {
  title: 'Meet an arrival',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
}

/**
 * Job 4 of the v2 rebuild: meet an arrival.
 *
 * The section guard is run here because this page does NOT sit under
 * `(staff)/[eventCode]/logistics/layout.tsx` — it is in the other route group,
 * and a route group's layouts apply only within that group. Without this line
 * the page would be guarded by the shell's `requireStaff` alone, which is a
 * wider door than the v1 arrivals board (a hospitality runner and a hamper
 * runner are both staff).
 */
export default async function ArrivalsPage({ params }: PageProps) {
  const { eventCode } = await params

  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  await requireSection(event.id, event.code, 'logistics')

  return <MeetArrivals eventId={event.id} eventCode={event.code} />
}
