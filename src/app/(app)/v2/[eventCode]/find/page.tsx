import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { getEventAccess, resolveEventByCode } from '@/lib/supabase/queries'

import { FindStaff } from './FindStaff'
import { FindClient } from './FindClient'

export const metadata: Metadata = {
  title: 'Find someone',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
}

/**
 * One box that finds anyone — V8's search, and the destination the header's
 * search button points at.
 *
 * WHY A FULL SCREEN AND NOT THE HEADER'S DROPDOWN. `docs/UI2-PROMPTS.md` §V8:
 * on a cheap handset a full screen is faster to hit and far easier to read than
 * a popover, and the bottom bar stays visible underneath, so a runner who
 * searched for the wrong person is one tap from their own section.
 *
 * TWO ROLES, TWO COMPONENTS, ONE ROUTE — and it is NOT a `requireStaff` gate.
 * A client must be able to search their own list, so bouncing them here would
 * be the bug, not the guard. What matters is which rows they can reach, and
 * that is decided in two independent places:
 *
 *   1. Here — `access` from `getEventAccess` (per-request memoised, so the
 *      shell already paid for it) picks the component. The two components do
 *      not share a data path, so a client cannot be handed a staff read by a
 *      prop default. `FindStaff` searches `client_guest_profiles` plus the
 *      staff-only mobile RPC (`search_guest_profiles`, invoker rights, zero
 *      rows for a client); `FindClient` searches the client list it already
 *      has.
 *   2. RLS, which is the actual fence. This screen is a UX affordance: a client
 *      who reached a staff component would still read nothing staff-only,
 *      because every read behind it runs as them.
 *
 * THE PHONE TRAP, recorded here because it is the reason this is a branch and
 * not a parameter. `app.role_in_event` (and therefore `app.is_member`) answers
 * for BOTH roles, and the view `client_guest_profiles` is fenced on exactly
 * that (`where app.is_member(event_id)`) — so a client DOES read it, and
 * `findGuests` reads it for both roles for that reason. The phone leg is the
 * one thing that differs: `search_guest_profiles` is `language sql stable`
 * with no `security definer`, so a client gets zero rows from it. It is passed
 * `withMobile={false}` for a client regardless, so the phone column is not even
 * asked for on their behalf.
 */
export default async function FindPage({ params }: PageProps) {
  const { eventCode } = await params

  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  const access = await getEventAccess(event.id)

  // Unreachable in practice: `resolveEventByCode` runs under RLS and already
  // returned null for a non-member, so the shell 404'd before we got here.
  // Written down rather than assumed — see the same note in
  // `guests/list/page.tsx`.
  if (access === 'none') notFound()

  if (access === 'client') {
    return <FindClient eventId={event.id} eventCode={event.code} />
  }

  return <FindStaff eventId={event.id} eventCode={event.code} />
}
