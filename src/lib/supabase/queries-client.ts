'use client'

import { supabase } from '@/lib/supabase/client'
import { readSessionClaims } from '@/lib/auth/session-client'
import type { Membership } from '@/lib/events/paths'
import type { Viewer, EventAccess, StaffAccess } from '@/lib/supabase/queries-types'

/**
 * Client-side counterparts to the server guards in queries.ts.
 *
 * Every one of these is a straight port, deliberately preserving the original
 * semantics rather than simplifying them — the comments in queries.ts document
 * bugs that were paid for once already, and the same traps exist here:
 *
 *  - `is_active` is read alongside `global_role`, because `app.is_admin()` is
 *    `global_role = 'admin' AND is_active`. Reading the role alone makes the
 *    app disagree with the database and tell a deactivated admin that a
 *    database holding three live weddings has no events in it.
 *  - The code-auth branch comes FIRST. A team/client session has no GoTrue
 *    user, so `auth.getUser()` returns null and every screen would bounce to
 *    /login if the claims were not checked before it.
 *  - `resolveEventByCode` keeps the case-insensitive retry.
 *
 * None of these is an authorisation boundary. RLS is the fence — that was true
 * of the server versions too (see the header on `requireStaff` in queries.ts)
 * and is what makes moving them onto the device sound rather than a weakening.
 * They exist for HONESTY: under RLS "you may not read this" and "there is no
 * data here" are the same empty result, so a client left on a staff screen
 * would be shown a confident, fabricated "0 families".
 */

/**
 * Client-side replacement for the server's request-scoped `perRequest` memo.
 *
 * A server render has a natural cache scope — one request. A long-lived
 * WebView does not, so this is a TTL cache instead. 30s matches the server's
 * `eventCache` and is chosen for the same reason: long enough to collapse the
 * burst of reads one screen makes on mount, short enough that a revoked code
 * or a renamed event corrects itself while staff are still looking at it.
 */
const TTL_MS = 30_000

type CacheEntry = { value: unknown; expires: number }
const cache = new Map<string, CacheEntry>()

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit && hit.expires > Date.now()) return hit.value as T

  const value = await fn()
  // Only cache a truthy answer. Caching a miss would make a freshly created
  // event 404 for 30s, and a miss is the more sensitive of the two answers.
  // 'none' from getEventAccess is a real answer and is cached by its own call
  // site, which passes through this guard deliberately.
  if (value !== null && value !== undefined) {
    cache.set(key, { value, expires: Date.now() + TTL_MS })
  }
  return value
}

/**
 * Drop the cache. Call after anything that changes who the viewer is or what
 * they can reach: login, logout, staff pick, event switch.
 *
 * Without this a sign-out followed by a different login inside 30s would read
 * the previous viewer's cached identity — the client-side shape of the RSVP
 * 404 regression that a memoised server client caused (see queries.ts).
 */
export function invalidateClientQueries(): void {
  cache.clear()
}

/**
 * Who is signed in, and what they can reach.
 *
 * A convenience for rendering — NOT an authorisation gate. Do not branch on
 * `isAdmin` to decide whether a write is allowed; attempt the write and let
 * the database refuse it.
 */
export async function getViewerClient(): Promise<Viewer | null> {
  return cached('viewer', getViewerUncached)
}

async function getViewerUncached(): Promise<Viewer | null> {
  // Code-auth session (team/client): no GoTrue user exists, but the claims ARE
  // the identity. Build the viewer from them so team/client screens (RSVP,
  // call, review) do not bounce to /login.
  const claims = await readSessionClaims()
  if (claims) {
    const { data: event } = await supabase
      .from('events')
      .select('name, code')
      .eq('id', claims.eventId)
      .maybeSingle()
    if (!event) return null
    return {
      userId: claims.accessCodeId,
      email: null,
      fullName: claims.staffMemberId ?? null,
      isAdmin: false,
      memberships: [
        {
          eventId: claims.eventId,
          eventName: event.name,
          eventCode: event.code,
          role: claims.appRole === 'team' ? 'event_team' : 'client',
        },
      ],
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const [{ data: profile }, { data: members }] = await Promise.all([
    supabase
      .from('profiles')
      .select('full_name, global_role, is_active')
      .eq('id', user.id)
      .maybeSingle(),
    supabase
      .from('event_members')
      .select('event_id, role, events(name, code)')
      .order('created_at', { ascending: true }),
  ])

  // Both halves of `app.is_admin()` — see the header note.
  const isAdmin = profile?.global_role === 'admin' && profile.is_active === true

  let memberships: Membership[] = (members ?? []).flatMap((m) => {
    const ev = m.events as { name: string; code: string } | null
    if (!ev) return []
    return [{ eventId: m.event_id, eventName: ev.name, eventCode: ev.code, role: m.role }]
  })

  // An admin has no event_members rows but can reach every event, so fall back
  // to listing events directly — RLS on `events` uses is_member(id), which is
  // true for an admin on every row.
  if (isAdmin) {
    const { data: allEvents } = await supabase
      .from('events')
      .select('id, name, code')
      .order('created_at', { ascending: false })

    memberships = (allEvents ?? []).map((e) => ({
      eventId: e.id,
      eventName: e.name,
      eventCode: e.code,
      role: 'event_team' as const,
    }))
  }

  return {
    userId: user.id,
    email: user.email ?? null,
    fullName: profile?.full_name ?? null,
    isAdmin,
    memberships,
  }
}

/** Resolve an event by its short code, or null if the viewer cannot see it. */
async function getEventByCodeClient(code: string) {
  return cached(`event:${code}`, async () => {
    const { data } = await supabase.from('events').select('*').eq('code', code).maybeSingle()
    return data
  })
}

/**
 * `getEventByCodeClient` with a case-insensitive retry.
 *
 * Codes are short slugs like SHARMA26. Accept a lower-cased URL rather than
 * 404ing on someone who typed it by hand — then render every link from the
 * canonical `event.code`, so the URL self-corrects on the next tap.
 */
export async function resolveEventByCodeClient(code: string) {
  const exact = await getEventByCodeClient(code)
  if (exact) return exact

  const upper = code.toUpperCase()
  if (upper === code) return null

  return getEventByCodeClient(upper)
}

/**
 * The viewer's role on one event, computed from exactly the three inputs
 * `app.is_staff()` uses: `profiles.global_role`, `profiles.is_active` and
 * `event_members.role`. All are readable-by-self under RLS, so this answer
 * matches the database's — including for a deactivated admin, for whom
 * `app.is_admin()` is false.
 */
export async function getEventAccessClient(eventId: string): Promise<EventAccess> {
  // 'none' is a real answer and must be cacheable, so it is wrapped rather
  // than returned through `cached` (which drops nullish values only — 'none'
  // is a string and survives).
  return cached(`access:${eventId}`, () => getEventAccessUncached(eventId))
}

async function getEventAccessUncached(eventId: string): Promise<EventAccess> {
  // Code-auth session (team/client) — the claims carry the role and event.
  const claims = await readSessionClaims()
  if (claims) {
    if (claims.eventId !== eventId) return 'none'
    return claims.appRole === 'team' ? 'event_team' : 'client'
  }

  // GoTrue session (admin) — resolve via profiles/event_members.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return 'none'

  const [{ data: profile }, { data: member }] = await Promise.all([
    supabase.from('profiles').select('global_role, is_active').eq('id', user.id).maybeSingle(),
    supabase
      .from('event_members')
      .select('role')
      .eq('event_id', eventId)
      .eq('user_id', user.id)
      .maybeSingle(),
  ])

  // Both halves of `app.is_admin()`. A deactivated admin falls through to
  // their `event_members` row — usually none, so 'none' — which is exactly
  // what the database would answer.
  if (profile?.global_role === 'admin' && profile.is_active) return 'admin'
  if (member?.role === 'event_team') return 'event_team'
  if (member?.role === 'client') return 'client'
  return 'none'
}

/** admin or event_team on this event — i.e. `app.is_staff(event_id)`. */
export async function isEventStaffClient(eventId: string): Promise<boolean> {
  const access = await getEventAccessClient(eventId)
  return access === 'admin' || access === 'event_team'
}

export type { Viewer, EventAccess, StaffAccess }
