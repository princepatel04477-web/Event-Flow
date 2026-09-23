'use client'

import { ClientGuestDirectory } from '../guests/_components/ClientGuestDirectory'

export interface FindClientProps {
  eventId: string
  eventCode: string
}

/**
 * Find, for a client — their own list, and nothing else.
 *
 * The same component the client's guest list renders, deliberately. It reads
 * `client_guest_profiles` under the `client-guests:<eventId>` cache key, which
 * is the key `ClientGuestDirectory` already fills — so a client who has opened
 * their guest list once can search it with NO network at all, and the two
 * screens can never disagree about what the client is allowed to see.
 *
 * `eventCode` is accepted and unused: a client's results have nowhere to link
 * (the family record is a staff screen), so it carries no destination. Kept on
 * the props because `find/page.tsx` passes it and the signature is what the
 * route reads.
 */
export function FindClient({ eventId }: FindClientProps) {
  return <ClientGuestDirectory eventId={eventId} />
}

export default FindClient
