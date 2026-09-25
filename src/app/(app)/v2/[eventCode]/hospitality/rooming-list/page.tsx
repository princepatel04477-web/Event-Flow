import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import { requireSection } from '@/lib/auth/section-guard'
import { resolveEventByCode } from '@/lib/supabase/queries'

import { RoomingList } from './RoomingList'

export const metadata: Metadata = { title: 'Rooming list' }

type PageProps = {
  params: Promise<{ eventCode: string }>
}

/**
 * The rooming list — the sheet a hotel is handed.
 *
 * WHY IT LIVES UNDER `hospitality` AND IS STILL ADMIN-ONLY. It is a Rooms
 * screen and the nav child is declared in `SECTIONS.hospitality`, but every row
 * on it is a door into a DIFFERENT section: the family head opens the RSVP
 * status screen, the hamper opens the hamper proof. A hospitality runner is not
 * a member of `rsvp` or `hamper`, so for them half the rows would be taps that
 * bounce back with `?denied=section` — live-looking controls that cannot work
 * (R3). `roles: ['admin']` on the nav child is deliberate and this guard is the
 * same gate, so a typed URL cannot reach a screen the tab bar hides. Admin and
 * `management` reach it; every `event_team` session does not.
 *
 * The guard is run HERE and not inherited. `hospitality/layout.tsx` gates the
 * tree on the union of `hospitality` and `hamper`, so inheriting would admit a
 * hamper runner — the exact audience this screen must not serve.
 */
export default async function RoomingListPage({ params }: PageProps) {
  const { eventCode } = await params

  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  const ctx = await requireSection(event.id, event.code, 'hospitality')
  if (ctx.access !== 'admin') redirect(`/${event.code}`)

  return <RoomingList eventId={event.id} eventCode={event.code} eventName={event.name} />
}
