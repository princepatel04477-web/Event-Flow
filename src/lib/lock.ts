'use client'

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { queryKeys } from '@/lib/query/keys'
import { createClient } from '@/lib/supabase/client'
import { formatDateTime } from '@/lib/utils'

/**
 * The caller lock, as something a runner can act on.
 *
 * WHY THIS MODULE EXISTS. CLAUDE.md §11b: a caller's phone dying mid-RSVP
 * leaves their family uneditable for 15 minutes, migration `20260813000000`
 * removed `release_group`'s admin branch, and `locked_until` expiry is now the
 * ONLY recovery mechanism. V10 Part C fixes the half that is fixable without a
 * migration — the DISCOVERY half. Until now the queue card said "Another caller
 * has this family open", which names nobody and no time, and §11b is explicit
 * that the presence label ("Ravi, 2 min ago") is presence, not lock state, and
 * must not be used as one.
 *
 * WHAT IT NEEDS THAT THE VIEW DOES NOT CARRY. `v_rsvp_queue` has `is_locked`
 * and `locked_until`, but the id of the holder is `locked_by_staff` — a team
 * session's attribution column (CLAUDE.md §5.9) — and that is a uuid. There is
 * no name on the row, and no read that joins one in:
 *
 *   - the view cannot be joined from PostgREST without an embedded resource
 *     relation, which a view does not declare;
 *   - `guest_groups.locked_by` (an auth uid) has no name this app may read —
 *     `profiles` is not a table a staff session selects from;
 *   - a migration adding `locked_by_staff` back to the view is out of bounds
 *     for this session (AMENDMENTS §4; CLAUDE.md §11b says the same).
 *
 * So the name comes from `staff_members` for the event — one row per staff
 * member, a handful on any real event, and the same read the "Who are you?"
 * picker already makes under the same policy (`staff_members_sel`, which is
 * `app.is_admin() or app.is_staff(event_id)`). The id-to-name map is the join,
 * done once per event rather than per locked family.
 *
 * AN UNRESOLVABLE HOLDER IS SAID OUT LOUD, NOT GUESSED. `locked_by` (an admin
 * session) has no `staff_members` row at all, so there is genuinely no name to
 * show. "Another phone" is the honest answer there, and it is still better than
 * the nothing the card said before, because the clear time is displayed either
 * way.
 */
export interface StaffNameLookup {
  /** `staff_members.id` → `full_name`, for everyone on this event. */
  nameOf: (staffMemberId: string | null | undefined) => string | null
}

/** How long the staff roster is trusted. A roster does not change mid-shift. */
const ROSTER_STALE_MS = 5 * 60_000

/**
 * The event's staff names, cached under its own key so two screens showing a
 * lock share one read.
 *
 * Read in the browser under the viewer's own RLS, exactly like the queue beside
 * it (`src/lib/query/reads.ts` explains why the calling screens are not routed
 * through a server action: it would add a round trip to Seoul to a screen whose
 * whole problem is round trips to Seoul).
 */
export function useStaffNames(eventId: string): StaffNameLookup {
  const { data } = useQuery({
    queryKey: queryKeys.staff.names(eventId),
    staleTime: ROSTER_STALE_MS,
    queryFn: async (): Promise<Record<string, string>> => {
      const supabase = createClient()
      const { data: rows } = await supabase
        .from('staff_members')
        .select('id, full_name')
        .eq('event_id', eventId)
        .eq('is_active', true)

      const map: Record<string, string> = {}
      for (const row of rows ?? []) {
        const name = row.full_name?.trim()
        if (name) map[row.id] = name
      }
      return map
    },
  })

  return useMemo(() => {
    const names = data ?? {}
    return {
      nameOf: (id) => {
        if (!id) return null
        return names[id] ?? null
      },
    }
  }, [data])
}

/** The lock columns, as both `v_rsvp_queue` and `guest_groups` expose them. */
export interface LockFacts {
  /** `v_rsvp_queue.is_locked` — the view's own server-clock test. */
  isLocked: boolean | null | undefined
  /** `locked_until` — the instant the lock clears, server clock. */
  lockedUntil: string | null | undefined
  /** `locked_by_staff` — the team member holding it, when the view carries it. */
  lockedByStaff?: string | null
}

/** What a locked row shows. */
export interface LockNote {
  /** True while the lock still stands, judged against the phone's own clock. */
  locked: boolean
  /** "Ravi" or, when there is genuinely no name to show, "Another phone". */
  holder: string
  /** "21:47" — the exact minute the lock clears, device-local. */
  clearAt: string | null
  /** One sentence for a card. */
  sentence: string
  /** Short form for a list row's meta line. */
  short: string
}

/**
 * Turn lock facts into a sentence, or `null` when the family is not locked.
 *
 * THE PHONE'S CLOCK DECIDES `locked`, deliberately, and it is the one place in
 * this app that is allowed to: `locked_until` is a server-stamped instant and
 * the question is "is that instant in my past" — a comparison of two absolute
 * times, which a skewed phone clock still gets right at the minute granularity
 * a runner is reading. (Everything else — a callback being due, an attempt's
 * age — compares against `now()` in SQL, never here.)
 *
 * A STALE `is_locked` IS REPORTED AS STALE rather than as a live lock. The queue
 * query can be up to its `staleTime` old, so a lock that has already expired can
 * still be on screen. Rendering "locked until 21:47" at 21:52 sends a runner to
 * walk away from a family that is free; the sentence says to reload instead.
 */
export function lockNote(
  facts: LockFacts,
  names: StaffNameLookup,
  now: number = Date.now(),
): LockNote | null {
  if (!facts.isLocked) return null

  const holder = names.nameOf(facts.lockedByStaff) ?? NO_NAME
  const until = facts.lockedUntil ? new Date(facts.lockedUntil) : null
  const untilMs = until && !Number.isNaN(until.getTime()) ? until.getTime() : null

  if (untilMs !== null && untilMs <= now) {
    return {
      locked: false,
      holder,
      clearAt: null,
      sentence: `${holder} had this family open, but that has now run out — reload to bring the family back.`,
      short: 'Was open on another phone — reload',
    }
  }

  const clearAt =
    untilMs === null
      ? null
      : formatDateTime(untilMs, { hour: '2-digit', minute: '2-digit', hour12: false })

  // `firstWord`, not the full name: a runner reads the card from a hand's
  // length away, and "Ravi" is what they say out loud to the person next to
  // them. The unresolved case builds its own clause instead — "Another phone has
  // this family open on another phone" is what substituting the fallback into
  // the same template produced, and it reads as nonsense.
  const opened =
    holder === NO_NAME
      ? 'This family is open on another phone.'
      : `${firstWord(holder)} already has this family open on another phone.`

  const tail = clearAt
    ? `It frees up on its own by ${clearAt}.`
    : 'It frees up on its own shortly.'

  return {
    locked: true,
    holder,
    clearAt,
    sentence: `${opened} ${tail}`,
    short: 'Open on another phone',
  }
}

/**
 * The holder, when the lock's owner cannot be resolved to a person.
 *
 * An admin claims through `guest_groups.locked_by` — an auth uid, with no
 * `staff_members` row and no name this app may read — so this is a real case,
 * not a defensive branch. It is still better than what the card said before,
 * because the clear time is shown either way.
 */
const NO_NAME = 'Another phone'

function firstWord(name: string): string {
  const first = name.trim().split(/\s+/)[0]
  return first || NO_NAME
}
