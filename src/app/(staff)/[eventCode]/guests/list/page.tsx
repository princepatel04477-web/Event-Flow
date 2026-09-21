import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query'

import { getEventAccess, resolveEventByCode } from '@/lib/supabase/queries'
import { queryKeys } from '@/lib/query/keys'
import { readGuestsList } from '@/lib/query/reads'

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

  // Warm the cache on the SERVER so the first paint already has rows and the
  // client does not turn round and ask for the same list again. Without this a
  // dehydrate/hydrate pair fires the read twice on first load — once here and
  // once on mount — which is worse than not prefetching at all.
  //
  // This is safe to do here and NOT on the queue or arrivals screens: those two
  // read `v_rsvp_queue` / `travel_legs` under the browser's own RLS session, so
  // a server prefetch would either use a different identity path or need a
  // second copy of the query on the server. They fetch once, on the client, into
  // the same shared cache — one request, so nothing is doubled.
  //
  // A `QueryClient` per request, never module scope: a shared one would leak one
  // staff member's hydrated rows into another's render.
  const queryClient = new QueryClient()
  await queryClient.prefetchQuery({
    queryKey: queryKeys.guests.list(event.id),
    queryFn: () => readGuestsList(event.id),
  })

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <GuestsClient eventId={event.id} eventCode={event.code} />
    </HydrationBoundary>
  )
}
