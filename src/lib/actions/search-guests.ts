'use server'

import { createClient } from '@/lib/supabase/server'
import { friendlyDbError } from '@/lib/errors'
import type { Database } from '@/lib/supabase/database.types'

/** Per-phase timing for server actions (instrument-first). */
function phaseTiming(label: string) {
  const marks: Record<string, number> = {}
  let last = performance.now()
  return {
    mark(name: string) {
      const now = performance.now()
      marks[name] = Math.round(now - last)
      last = now
    },
    report() {
      const parts = Object.entries(marks).map(([k, v]) => `${k}:${v}ms`)
      console.log(`[perf] ${label} phases :: ${parts.join(' · ')}`)
    },
  }
}

/**
 * A guest list/search result: the client_guest_profiles shape (so the
 * SAME GuestCard renders it) plus `group_id` (to link to the family's
 * RSVP record) and `phone` (the staff-visible search column).
 */
export type GuestSearchRow = Database['public']['Functions']['search_guest_profiles']['Returns'][number]

export type GuestSearchResult =
  | { ok: true; rows: GuestSearchRow[] }
  | { ok: false; reason: 'error'; message: string }

/** One staff-facing guest read, used for both the full list and search. */
async function readGuestRows(eventId: string, term: string, limit: number): Promise<GuestSearchResult> {
  const timing = phaseTiming('guests :: readGuestRows')
  const supabase = await createClient()
  timing.mark('client-create')
  const { data, error } = await supabase.rpc('search_guest_profiles', {
    p_event_id: eventId,
    p_term: term,
    p_limit: limit,
  })
  timing.mark('request')

  if (error) {
    return { ok: false, reason: 'error', message: friendlyDbError(error) }
  }
  timing.report()
  return { ok: true, rows: data ?? [] }
}

/**
 * The full guest list for the /guests screen — every guest row, same shape
 * as search (with group_id so each row links to its family's RSVP record),
 * fenced by RLS exactly like every staff read. The screen virtualises this
 * so the DB returning all 543 rows is fine — the DOM never mounts them all.
 */
export async function listGuests(eventId: string): Promise<GuestSearchResult> {
  return readGuestRows(eventId, '', 2000)
}

/**
 * Server-side guest search. Runs as the signed-in staff user, so RLS
 * applies exactly as it does to every other staff read — a client login
 * gets zero rows (guest_groups has no client select policy), keeping the
 * phone numbers out of the client view.
 *
 * Partial-match on family head name, individual guest name, and the
 * family's primary mobile (the trgm indexes in migration 1800 make this
 * `%term%` ILIKE cheap). Both Latin and Devanagari: ILIKE is
 * case-insensitive for Latin; Devanagari has no case, so a partial
 * Devanagari name matches verbatim. Capped at 50 — search is for finding
 * ONE family, not paging the world.
 */
export async function searchGuests(eventId: string, term: string): Promise<GuestSearchResult> {
  const query = term.trim()
  if (query.length < 2) {
    return { ok: true, rows: [] }
  }
  return readGuestRows(eventId, query, 50)
}
