import { findGuestsForEvent } from '@/lib/actions/find-guests'
import { listGuests, searchGuests, type GuestSearchRow } from '@/lib/actions/search-guests'
import type { Database } from '@/lib/supabase/database.types'

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

/* ------------------------------------------------------------------ */
/* /find                                                               */
/* ------------------------------------------------------------------ */

/** The row shape `client_guest_profiles` returns — what that view exposes. */
export type GuestProfileRow = Database['public']['Views']['client_guest_profiles']['Row']

/**
 * One search result, as the `/find` screen renders it.
 *
 * `profile` carries the row (name, family head, room, RSVP status, arrival
 * day); `groupId` carries the identity that opens the family's record. They are
 * separate because they come from two different relations, and because a client
 * gets the first and never the second — see `findGuests`.
 */
export interface FindResult {
  profile: GuestProfileRow
  groupId: string | null
}

/**
 * The `/find` screen's search, for BOTH roles.
 *
 * WHY TWO SOURCES, AND WHY THAT IS NOT A WORKAROUND.
 *
 * The brief's rule is "do not pull a full table to the client and filter it
 * there". Everything below is a bounded, per-term, SERVER-SIDE filter; the
 * guest list is never read whole and never filtered on the phone. What the two
 * sources buy is the four things the brief asks to match on, which no single
 * existing read can do alone:
 *
 *   1. `client_guest_profiles` (the VIEW) is the only read that has
 *      `room_number` — it is not a column of `guest_groups`, it lives on
 *      `rooms`, reached through `room_assignments`. It is also the row shape the
 *      screen renders and the row set `ClientGuestList` already searches, so
 *      staff and client results look identical. It has no `group_id`, though,
 *      so a row from it cannot open a family.
 *   2. `search_guest_profiles` (the RPC) is the only read that has
 *      `primary_mobile` — `guest_groups` has no client select policy, so the
 *      phone column cannot be reached through the view at all — and it is the
 *      only one that returns `group_id`. Its `where` is name / head / mobile, so
 *      it answers three of the four match kinds. It runs as the INVOKER: a
 *      client gets zero rows from it, which is why the whole RPC leg is
 *      staff-only here rather than merely checked.
 *
 * So: the RPC supplies the phone match and the `group_id`; the view supplies the
 * room match and the `rsvp_status` the row's pill needs. Both are `limit`-capped
 * (50, one screen of results), and they run in PARALLEL — two filters, one round
 * trip's worth of waiting.
 *
 * WHAT THIS IS NOT. It is not an authorisation decision. The view is
 * `security_invoker = false` (CLAUDE.md §8), so base-table RLS does not apply to
 * it and its `where app.is_member(event_id)` is the only fence — staff and the
 * client of this event are both members and read the same rows. That is correct
 * here BECAUSE this row set is exactly what the client already sees. The phone
 * leg is the one asymmetric read, and `withMobile` (set from the server's own
 * access answer in `find/page.tsx`, never from the URL) keeps even the REQUEST
 * from being made on a client's behalf.
 *
 * `limit` is a cap, not a page size: search is for finding one family.
 */
export async function findGuests(
  eventId: string,
  term: string,
  { limit = 50, withMobile = false }: { limit?: number; withMobile?: boolean } = {},
): Promise<FindResult[]> {
  // The search itself lives in `src/lib/actions/find-guests.ts`, as a server
  // action. It cannot live here: this module is imported by client components,
  // and reaching Supabase from it means importing `server-only`, which fails
  // `npm run build` with "`server-only` cannot be imported from a Client
  // Component module" — a failure tsc, eslint and the whole test suite do not
  // see.
  return findGuestsForEvent(eventId, term, { limit, withMobile })
}

/* The query legs, the RPC row re-shape and the PostgREST escaping that this
   wrapper used to hold now live beside the action in
   `src/lib/actions/find-guests.ts`. They moved because they cannot run in the
   browser: this file is in the client graph and they need the server client. */
