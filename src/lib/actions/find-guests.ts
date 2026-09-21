'use server'

import { friendlyDbError } from '@/lib/errors'
import type { GuestSearchRow } from '@/lib/actions/search-guests'
import { createClient } from '@/lib/supabase/server'
import type { FindResult, GuestProfileRow } from '@/lib/query/reads'

/**
 * The `/find` search, as a server action.
 *
 * WHY THIS IS AN ACTION AND NOT A FUNCTION IN `reads.ts`, WHICH IS WHERE IT
 * STARTED. `src/lib/query/reads.ts` is imported by CLIENT components — the
 * guest list, and the find screen. A module in that graph may not import
 * `src/lib/supabase/server`, because that file is `server-only` and Turbopack
 * fails the build with "`server-only` cannot be imported from a Client
 * Component module". `tsc` does not see it, eslint does not see it, and the
 * whole vitest suite stays green through it: only `npm run build` catches it,
 * and in `next dev` the import throws at runtime in the browser instead.
 *
 * That is exactly what happened: the first version of `/find` put
 * `await createClient()` inside `reads.ts`. The fix is not to import the client
 * lazily — the browser really does call this function, so a dynamic import
 * would evaluate `server-only` on the phone. The queries have to run on the
 * server, which means a `'use server'` boundary, which means this file. It also
 * matches how every other read in `reads.ts` already works: the wrapper calls an
 * action.
 *
 * The `withMobile` flag is decided by `find/page.tsx` from the server's own
 * access answer, never from the URL, so even the RPC request is not made on a
 * client's behalf.
 */
export async function findGuestsForEvent(
  eventId: string,
  term: string,
  { limit = 50, withMobile = false }: { limit?: number; withMobile?: boolean } = {},
): Promise<FindResult[]> {
  const query = term.trim()
  if (query.length < 2) return []

  const safe = escapeForPostgrest(query)
  // An empty `safe` means the term was nothing but punctuation. Running
  // `ilike '%%'` would return the first 50 guests in the event — a list
  // presented as the answer to a search. Ask for nothing instead.
  if (!safe) return []

  const supabase = await createClient()

  const [rpcRows, viewRows] = await Promise.all([
    // Staff only. For a client this leg is not even requested.
    withMobile ? searchStaffRows(supabase, eventId, safe, limit) : Promise.resolve([]),
    searchViewRows(supabase, eventId, safe, limit),
  ])

  // The view's copy is what gets rendered (it has `rsvp_status`), and the RPC's
  // copy is what supplies `group_id`. Keyed by `guest_id`, which the RPC builds
  // with `coalesce(gu.id, gg.id)` and the view carries as `g.id` — the same
  // value for a guest that has a `guests` row.
  const profileById = new Map<string, GuestProfileRow>()
  for (const row of viewRows) {
    if (row.guest_id) profileById.set(row.guest_id, row)
  }

  const results: FindResult[] = []
  const used = new Set<string>()

  for (const row of rpcRows) {
    // Phone matches (and any head/guest match the view also found) arrive here
    // with the family id the view cannot supply. Where the view has the same
    // guest, ITS row is rendered — it is the one carrying `rsvp_status`.
    const id = String(row.guest_id ?? '')
    const profile = profileById.get(id) ?? asProfileRow(row)
    if (!profile) continue
    results.push({ profile, groupId: row.group_id ?? null })
    if (id) used.add(id)
  }

  // Room matches the RPC cannot find, and any guest row the RPC's name match
  // missed. They render, but they have no family id to open — stated in
  // `FindResult` rather than faked with an empty segment.
  for (const row of viewRows) {
    if (results.length >= limit) break
    if (row.guest_id && used.has(row.guest_id)) continue
    results.push({ profile: row, groupId: null })
  }

  return results.slice(0, limit)
}

/** The name / family-head / room leg, over the view. */
async function searchViewRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  safe: string,
  limit: number,
): Promise<GuestProfileRow[]> {
  const { data, error } = await supabase
    .from('client_guest_profiles')
    .select('*')
    .eq('event_id', eventId)
    // ILIKE '%term%' on three columns. `or` is how PostgREST spells the
    // disjunction; the term is escaped by the caller because `,` `.` `(` `)`
    // and `*` are all grammar to this filter, not characters to match.
    .or(
      [
        `guest_name.ilike.%${safe}%`,
        `family_head.ilike.%${safe}%`,
        `room_number.ilike.%${safe}%`,
      ].join(','),
    )
    // Family, then guest — the same order the guest list uses, so a family
    // found here reads the same way it reads there.
    .order('family_head', { ascending: true, nullsFirst: false })
    .order('guest_name', { ascending: true, nullsFirst: false })
    .limit(limit)

  // An empty result and a failed read look identical if only `data` is checked.
  // Throw, so the query layer reports a load failure rather than rendering the
  // confident, fabricated "nothing matches" this app has already shipped once.
  if (error) throw new Error(friendlyDbError(error))
  return data ?? []
}

/**
 * The name / head / mobile leg, over the staff RPC.
 *
 * A `select` on `guest_groups` would have been one table instead of an RPC, but
 * it could not return the guest's own name, and the RPC's `ilike` on
 * `primary_mobile` is the read the trgm index in migration 1800 was built for.
 * Using it also means the last-4-digit rule needs no new SQL: `%3210%` matches
 * "98765 43210", which is the whole reason staff can find a family from four
 * digits they know.
 *
 * Runs as the CALLER (no `security definer`), so for a client login it returns
 * zero rows rather than leaking. `withMobile` above is a round-trip saver, not
 * the fence — RLS is the fence.
 */
async function searchStaffRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
  safe: string,
  limit: number,
): Promise<GuestSearchRow[]> {
  const { data, error } = await supabase.rpc('search_guest_profiles', {
    p_event_id: eventId,
    p_term: safe,
    p_limit: limit,
  })
  if (error) throw new Error(friendlyDbError(error))
  return data ?? []
}

/**
 * Re-shape an RPC row into the view's row for a guest the view did NOT return.
 *
 * This only runs for a row the view has no copy of — a phone match whose guest
 * is otherwise unsearchable, which in practice is rare. It exists so such a row
 * still renders with a name, a room and an arrival day instead of vanishing
 * from a search the database answered.
 *
 * The RPC's `phone` column is NOT copied. The brief's result row does not
 * include a mobile number, and a search screen is not the place to start
 * printing guest mobiles — the column existing in the query is not a reason to
 * put it on the glass.
 *
 * `guest_id` is `coalesce(gu.id, gg.id)` coming out of the RPC and is NOT NULL
 * there; the guard is for the generated type, which marks every OUT column
 * nullable. A row without an id cannot be keyed, so it is dropped rather than
 * given a synthetic one that the merge could collide on.
 */
function asProfileRow(row: GuestSearchRow): GuestProfileRow | null {
  if (!row.guest_id) return null
  return {
    event_id: row.event_id,
    guest_id: row.guest_id,
    guest_name: row.guest_name,
    family_head: row.family_head,
    group_type: row.group_type,
    side: row.side,
    pax: row.pax,
    rsvp_status: null,
    hotel_name: row.hotel_name,
    room_number: row.room_number,
    arrival_date: row.arrival_date,
    arrival_time: row.arrival_time,
    arrival_mode: row.arrival_mode,
    arrival_point: row.arrival_point,
    departure_date: row.departure_date,
    departure_time: row.departure_time,
    departure_mode: row.departure_mode,
    departure_point: row.departure_point,
    hamper_delivered: row.hamper_delivered,
    return_gift_delivered: row.return_gift_delivered,
    needs_return_gift: row.needs_return_gift,
  }
}

/**
 * Make a typed term safe to interpolate into a PostgREST filter.
 *
 * PostgREST's `or=(col.ilike.%x%)` grammar separates filters with `,` and
 * arguments with `.`; a comma or a dot in a search box would therefore change
 * the QUERY rather than the pattern, and a `(`/`)` would break it outright. The
 * characters that matter in a name or a mobile number are untouched — this
 * strips punctuation out of the term, it does not strip letters, digits, spaces
 * or Devanagari. `*` is removed because PostgREST reads it as its own wildcard,
 * which would make "R*" match everything.
 */
function escapeForPostgrest(term: string): string {
  return term.replace(/[,().*\\"']/g, '')
}
