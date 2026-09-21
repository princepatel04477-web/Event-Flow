import { listGuests, searchGuests, type GuestSearchRow } from '@/lib/actions/search-guests'

/**
 * Thin typed wrappers over the reads the cached screens need.
 *
 * NOT marked `'use server'`, deliberately. Each wrapper is an ordinary async
 * function that calls an EXISTING server action, so the same function is usable
 * from a client component (the action becomes a client callable) and from a
 * server component (the action runs in-process). That is what lets a page
 * prefetch into the cache on the server and hand the client a warm one, without
 * writing the read twice.
 *
 * The wrappers exist for one reason: the actions return a result union
 * (`{ ok: true, rows } | { ok: false, message }`) which TanStack cannot cache
 * usefully — an error has to be THROWN to become a query error, or the error
 * branch ends up cached as data and every later read reports success. So the
 * unwrapping lives here, once, instead of in each component.
 *
 * NOTE ON WHAT IS NOT HERE. The calling queue and arrivals are not wrapped,
 * because there is no server action to wrap: both read Supabase directly in the
 * browser under the viewer's own RLS, and both keep doing exactly that inside
 * their `queryFn`. Converting them to a server action would move the read onto
 * the server identity path and add a round trip to Seoul to a screen whose whole
 * problem is round trips to Seoul.
 */

/** Every guest row, for the windowed list. Server-action backed. */
export async function readGuestsList(eventId: string): Promise<GuestSearchRow[]> {
  const result = await listGuests(eventId)
  if (!result.ok) {
    throw new Error(result.message || 'Could not load the guest list. Check your connection and try again.')
  }
  return result.rows
}

/** Name / mobile search. Server-action backed. */
export async function readGuestSearch(eventId: string, term: string): Promise<GuestSearchRow[]> {
  const result = await searchGuests(eventId, term)
  if (!result.ok) {
    throw new Error(result.message || 'Search is not available right now. Check your connection and try again.')
  }
  return result.rows
}
