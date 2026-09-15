'use server'

import { friendlyDbError } from '@/lib/errors'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/database.types'

/**
 * The client's read of the guest list.
 *
 * Separate from `search-guests.ts` on purpose. That module goes through
 * `search_guest_profiles`, which is `language sql stable` with no
 * `security definer` — it runs as the invoker, so `guest_groups` RLS applies
 * and a client login gets ZERO rows back. A client cannot use it and never
 * will; pointing the client screen at it is what emptied this screen out.
 *
 * This one reads `client_guest_profiles`, the one relation a client can see.
 *
 * TRAP: that view is `security_invoker = false`. It runs as its owner,
 * bypasses base-table RLS, and is fenced solely by its own
 * `where app.is_member(event_id)`. NEVER join it against a base table here —
 * PostgREST would reintroduce that table's RLS and the result would silently
 * come back empty for exactly the role this screen exists for.
 */

export type ClientGuestRow = Database['public']['Views']['client_guest_profiles']['Row']

export type ClientGuestResult =
  | { ok: true; rows: ClientGuestRow[] }
  | { ok: false; message: string }

/**
 * Dashboard stats for the client — light, computed from the guest list.
 * Zero additional queries: derive from what client_guest_profiles already returns.
 */
export interface ClientDashboardStats {
  totalGuests: number
  totalFamilies: number
  confirmedFamilies: number
  declinedFamilies: number
  pendingFamilies: number
  familiesWithHotel: number
  familiesWithRoom: number
  hamperDelivered: number
  returnGiftDelivered: number
}

/**
 * Every guest profile shared on this event, ordered family-then-name.
 *
 * Returns the whole set in one read (543 rows answered in ~5ms) and lets the
 * screen filter and window it. The cost of this list was never the query —
 * see the note in ClientGuestList about what actually took 26 seconds.
 */
export async function listClientGuests(eventId: string): Promise<ClientGuestResult> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('client_guest_profiles')
    .select('*')
    .eq('event_id', eventId)
    .order('family_head', { ascending: true, nullsFirst: false })
    .order('guest_name', { ascending: true, nullsFirst: false })

  // An empty read and a failed read look identical if you only check `data`.
  // Say which one happened rather than presenting a query error as "no guests".
  if (error) {
    return { ok: false, message: friendlyDbError(error) }
  }

  // Synthetic member rows (ensureGroupMembers / addGuestMember) are named
  // "<head> (guest N)" — they represent real beds, not real names. The count
  // must stay truthful (a 6-pax family IS six people), so keep every row, but
  // mask the placeholder name to the family head so a client never reads
  // "Sharma (guest 3)". A real (renamed) member never matches the pattern.
  const rows = (data ?? []).map((row) =>
    isPlaceholderName(row.guest_name, row.family_head)
      ? { ...row, guest_name: row.family_head }
      : row,
  )

  return { ok: true, rows }
}

/**
 * True when a guest name is the synthetic "<head> (guest N)" placeholder —
 * the exact shape both ensureGroupMembers and addGuestMember write. A real
 * member whose name happens to contain "(guest 2)" is not matched, because
 * the prefix must equal the family head's name.
 */
function isPlaceholderName(guestName: string | null, familyHead: string | null): boolean {
  if (!guestName || !familyHead) return false
  if (!guestName.startsWith(familyHead)) return false
  return /^\(guest \d+\)$/.test(guestName.slice(familyHead.length).trim())
}
