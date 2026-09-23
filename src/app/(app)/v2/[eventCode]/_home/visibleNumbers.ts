import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { TodayNumbers } from './today'

/**
 * The numbers Today falls back to when `readBoard()` cannot answer.
 *
 * ── The problem this solves, stated exactly ────────────────────────────────
 * `readBoard()` (src/lib/actions/dashboard.ts) reads ONE row out of
 * `v_event_board`, a `security_invoker = true` view anchored on `events`. It
 * returns `null` in three different situations and distinguishes none of them:
 *
 *   1. the read came back with an error that is not literally "the relation
 *      does not exist" — a permission denial, a statement timeout, a dropped
 *      connection;
 *   2. the read came back with no error and NO ROW, which is what row-level
 *      security answers when the viewer may not see the row (the page's own
 *      gate, `requireStaff`, is answered from the JWT claims and never asks the
 *      database, so a session can pass the gate and still read zero rows);
 *   3. the legacy two-view fallback answered without a `v_event_dashboard` row.
 *
 * The page then rendered `null` as "Could not load the numbers … reload the
 * page", which tells a runner on venue Wi-Fi to do the one thing that makes a
 * bad connection worse, and blames the server for what may be a permissions
 * answer. SPEC-V3's whole premise is that a screen must still be usable.
 *
 * ── What this reads instead, and why it is allowed to ──────────────────────
 * Three cheap, event-fenced reads against BASE TABLES, all of them already
 * readable by the same session that is looking at the screen (`guest_groups`
 * is the guest list itself; `room_assignments` and `deliverables` are read on
 * the rooms and hampers screens):
 *
 *   - `guest_groups`  → families, guests, called/confirmed/pending
 *   - `room_assignments` (active) → guests with a bed
 *   - `deliverables` (hamper) → delivered / still to deliver
 *
 * No RLS, policy, grant, view or action is changed by this file. It is a
 * READ, on the failure path only: the normal path costs nothing extra, because
 * the page only calls it when `readBoard` returned null.
 *
 * The four attention counters (`confirmedNoRoom`, `arrivalsNoVehicle`,
 * `noDeparture`, `hampersPending`) are NOT computable here without re-deriving
 * the view's joins, so they are reported as 0 — which makes the page fall back
 * to the department's own next action rather than inventing a problem. That is
 * the honest answer: "I cannot count that from here" is not "there is none",
 * and the page says which of the two it is looking at.
 */
export async function readVisibleNumbers(eventId: string): Promise<TodayNumbers | null> {
  const supabase = await createClient()

  const [groups, roomed, hampersDelivered, hampersPending] = await Promise.all([
    // One read of the three columns the arithmetic needs. At the top of the
    // real range this is ~240 rows and ~8KB; the client guest screen already
    // pulls a wider projection of the same table for the same reason (it has
    // to work offline). `head: true` counts cannot give the pax SUM, which is
    // the denominator of the rooms bar.
    supabase.from('guest_groups').select('rsvp_status, expected_pax, confirmed_pax').eq('event_id', eventId),
    supabase
      .from('room_assignments')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventId)
      .is('released_at', null),
    supabase
      .from('deliverables')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventId)
      .eq('kind', 'hamper')
      .eq('status', 'delivered'),
    supabase
      .from('deliverables')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventId)
      .eq('kind', 'hamper')
      .neq('status', 'delivered'),
  ])

  // If the guest list itself is not readable, nothing here is trustworthy, and
  // saying so (null) is better than rendering four honest zeros that read as
  // "an empty event".
  if (groups.error || !groups.data) return null

  let totalPax = 0
  let rsvpConfirmed = 0
  let rsvpPending = 0

  for (const row of groups.data) {
    const r = row as { rsvp_status: string | null; expected_pax: number | null; confirmed_pax: number | null }
    totalPax += r.confirmed_pax ?? r.expected_pax ?? 0
    if (r.rsvp_status === 'confirmed') rsvpConfirmed += 1
    else if (
      r.rsvp_status === 'not_started' ||
      r.rsvp_status === 'attempted' ||
      r.rsvp_status === 'callback' ||
      r.rsvp_status === 'tentative'
    ) {
      rsvpPending += 1
    }
  }

  return {
    totalGroups: groups.data.length,
    totalPax,
    rsvpConfirmed,
    rsvpPending,
    guestsRoomed: roomed.error ? 0 : (roomed.count ?? 0),
    hampersDelivered: hampersDelivered.error ? 0 : (hampersDelivered.count ?? 0),
    hampersPending: hampersPending.error ? 0 : (hampersPending.count ?? 0),
    // Not derivable without the view's joins. See the header.
    arrivalsToday: 0,
    departuresToday: 0,
    confirmedNoRoom: 0,
    arrivalsNoVehicle: 0,
    noDeparture: 0,
  }
}
