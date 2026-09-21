import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { requireSection } from '@/lib/auth/section-guard'
import { resolveEventByCode } from '@/lib/supabase/queries'

import { GiveRoom } from './GiveRoom'

export const metadata: Metadata = {
  title: 'Give a family a room',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
}

/**
 * Job 2 of the v2 rebuild: give a family a room.
 *
 * The section guard is run here rather than inherited, because it CANNOT be
 * inherited: `(staff)/[eventCode]/hospitality/layout.tsx` calls
 * `requireSection(..., 'hospitality')` and lives in the other route group, so
 * nothing under `(app)/v2/` passes through it. Without this line the only thing
 * standing between a travel runner and the room register would be the shell's
 * `requireStaff`.
 */
export default async function GiveRoomPage({ params }: PageProps) {
  const { eventCode } = await params

  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  await requireSection(event.id, event.code, 'hospitality')

  return <GiveRoom eventId={event.id} />
}
