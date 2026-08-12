import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { getEventAccess, resolveEventByCode } from '@/lib/supabase/queries'

import { GuestsClient } from './GuestsClient'
import { ClientGuestList } from './_components/ClientGuestList'

export const metadata: Metadata = {
  title: 'Guest list',
}

type PageProps = {
  // Next 15+ hands params over as a Promise.
  params: Promise<{ eventCode: string }>
}

/**
 * One URL, two screens — because two roles both live here and neither can use
 * the other's data source.
 *
 * DO NOT PUT `requireStaff` BACK ON THIS PAGE. It redirects a client to
 * `/{eventCode}/guests`, which is this page: the client's only permitted
 * screen bounced them at itself forever, and the loop surfaced as the event
 * error boundary ("This screen did not load"). This is the one route in the
 * app where the staff gate is the bug rather than the guard.
 *
 * Staff and admins get the windowed list over `search_guest_profiles` — every
 * row carries `group_id`, so each links to its family's RSVP record.
 *
 * A client gets `client_guest_profiles`, read-only, with no links out: the
 * RSVP record it would link to is a staff screen that would bounce them. The
 * two sources are not interchangeable — `search_guest_profiles` runs as the
 * invoker, so a client reads zero rows through it.
 *
 * `getEventAccess` is memoised per request, so resolving it here after the
 * layout already did costs nothing.
 */
export function generateStaticParams(): Array<Record<string, string>> {
  return []
}

export default async function GuestsPage({ params }: PageProps) {
  const { eventCode } = await params

  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  const access = await getEventAccess(event.id)

  // Unreachable in practice: `resolveEventByCode` runs under RLS and already
  // returned null for a non-member, so the layout 404'd before we got here.
  // Written down rather than assumed.
  if (access === 'none') notFound()

  if (access === 'client') {
    return <ClientGuestList eventId={event.id} />
  }

  return <GuestsClient eventId={event.id} eventCode={event.code} />
}
