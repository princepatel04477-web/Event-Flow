// M2 IN PROGRESS — this is still the SERVER guard layer and still 'server-only'.
//
// A codemod rewrote this header to claim the server imports had been replaced
// with client equivalents, and repointed `createClient` at ./client. That was
// incoherent: `sessionScope()` below reads `cookies()`, and requireStaff /
// requireAdmin call redirect()/notFound() — none of which a browser client can
// do. It also left this file failing to compile (9 errors).
//
// It cannot become a re-export shim over queries-client.ts either, and the
// reason is worth writing down so nobody tries again: the ~70 callers are
// `async function Page()` SERVER components. In a static export a server
// component renders ONCE at build time, with no session, so every guard would
// resolve to "no event" and every page would bake a redirect to /login. The
// pages have to become client components consuming EventProvider /
// useRequireStaff — see src/lib/client/event-context.tsx. Until they do, this
// file stays exactly as it was.
import 'server-only'

import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'

import { createClient } from './server'
export { createClient }

import { getSessionClaims } from '@/lib/auth/server'
import { CODE_AUTH_COOKIE } from '@/lib/auth/cookies'

import { perRequest } from '@/lib/request-cache'
import { ttlCache } from '@/lib/ttl-cache'

/**
 * Events are reference data: a name, a code and two dates, set when the event
 * is created and effectively fixed for its lifetime. Every staff route
 * resolves the event TWICE — the layout for the header, the page for its
 * guard — and each resolution was a full round trip to Seoul (~175ms
 * measured), which cost more than everything the page actually renders.
 *
 * A per-request memo alone does not fix it: measured, `perRequest` still left
 * 2 reads per request, so the layout and page do not share a React cache
 * scope here. This TTL cache is warm ACROSS requests, so the steady state is
 * zero round trips for the event lookup.
 *
 * SCOPED PER SESSION, DELIBERATELY. `getEventByCode` runs under RLS, so a
 * null means "not visible to YOU", and a row means "visible to you" — both are
 * facts about the VIEWER, not about the event. A cache keyed on the code alone
 * would hand one viewer's row to another, letting a non-member render an event
 * header for an event they cannot see. That is the tenancy fence in CLAUDE.md
 * §5.1, so the key carries a per-session fingerprint and two sessions can
 * never share an entry.
 *
 * Still not an auth cache: access is resolved per request by getEventAccess,
 * and RLS fences every read regardless. The only thing cached is the row a
 * given session already proved it was allowed to read.
 *
 * 30s, matching the dashboard counters. Worst case a renamed event shows its
 * old name in the header for 30 seconds.
 */
const eventCache = ttlCache<unknown>(30_000)

/**
 * Measurement switch. `NUVENT_PERF_BASELINE=1` disables the caches added by
 * the round-trip work, so the SAME build can be timed with and without them
 * (see e2e/measure-routes.mjs). Never set it in production: it only ever makes
 * the app slower, never less correct.
 */
export const PERF_BASELINE = process.env.NUVENT_PERF_BASELINE === '1'

/**
 * A stable, opaque per-session key for cache partitioning.
 *
 * Reads the session cookies directly — no network, no verification, because
 * this value is NEVER trusted as a claim. It only decides which cache bucket a
 * read lands in. A forged cookie gets its own bucket and still reads nothing:
 * the query behind the cache runs under RLS either way.
 *
 * Returns 'anon' when there is no session, which is correct — an anonymous
 * read is fenced to the anonymous bucket.
 */
async function sessionScope(): Promise<string> {
  const jar = await cookies()
  const parts: string[] = []
  for (const c of jar.getAll()) {
    // The code-auth JWT, and Supabase's GoTrue token cookies (sb-<ref>-auth-token,
    // possibly chunked as .0/.1).
    if (c.name === CODE_AUTH_COOKIE || (c.name.startsWith('sb-') && c.name.includes('auth-token'))) {
      parts.push(`${c.name}=${c.value}`)
    }
  }
  if (parts.length === 0) return 'anon'

  // Cheap non-cryptographic digest — this is a map key, not a security token.
  const joined = parts.sort().join('|')
  let h = 2166136261
  for (let i = 0; i < joined.length; i += 1) {
    h ^= joined.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

/** Per-phase timing for the route's session/guard reads (instrument-first). */
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

// Re-exported from `@/lib/events/paths`, which carries no `server-only` mark
// so the event switcher (a client component) can reach `eventHomePath`.
// Everything server-side keeps importing these from here.
export {
  eventHomePath,
  type EventRole,
  type GlobalRole,
  type Membership,
} from '@/lib/events/paths'

import type { Membership } from '@/lib/events/paths'

// Defined in queries-types.ts so queries-client.ts can import them without
// pulling 'server-only' in behind them. Re-exported here so existing
// `from '@/lib/supabase/queries'` imports keep resolving, and so there is one
// definition rather than two that can drift apart.
export type { Viewer, EventAccess, StaffAccess, DeniedReason } from '@/lib/supabase/queries-types'

import type { Viewer, EventAccess, StaffAccess, DeniedReason } from '@/lib/supabase/queries-types'

/**
 * Who is signed in, and what they can reach.
 *
 * This is a convenience for rendering — NOT an authorisation gate. Authorisation
 * lives in RLS. Do not branch on `isAdmin` to decide whether a write is allowed;
 * attempt the write and let the database refuse it.
 *
 * Returns null when there is no session.
 */
export async function getViewer(): Promise<Viewer | null> {
  // Memoised per request: the layout calls this for the nav and several pages
  // call it again. A null (no session) is never cached — see request-cache.ts.
  return perRequest('viewer', getViewerUncached)
}

async function getViewerUncached(): Promise<Viewer | null> {
  const timing = phaseTiming('route :: getViewer')

  // Code-auth session (team/client): no GoTrue user exists, but the claims
  // ARE the identity. Build the viewer from them so team/client pages that
  // call getViewer() (RSVP, call, review) do not bounce to /login.
  const claims = await getSessionClaims()
  timing.mark('claims')
  if (claims) {
    const supabase = await createClient()
    const { data: event } = await supabase
      .from('events')
      .select('name, code')
      .eq('id', claims.eventId)
      .maybeSingle()
    timing.mark('event')
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

  const supabase = await createClient()
  timing.mark('client-create')

  const {
    data: { user },
  } = await supabase.auth.getUser()
  timing.mark('getUser')
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
  timing.mark('profile+memberships')

  // `is_active` is not decoration. `app.is_admin()` is
  // `global_role = 'admin' AND p.is_active` (migration 0100), and deactivating
  // is the only offboarding the schema offers. Reading `global_role` alone
  // makes the app disagree with the database: a deactivated admin would be
  // shown the admin shell, then handed zero rows from `events` (RLS calls
  // `app.is_admin()`, which is now false) and told "no events exist" on a
  // database holding three live weddings. Read both, or state a falsehood.
  const isAdmin = profile?.global_role === 'admin' && profile.is_active === true

  // An admin has no event_members rows but can reach every event, so fall back
  // to listing events directly — RLS on `events` uses is_member(id), which is
  // true for an admin on every row.
  let memberships: Membership[] = (members ?? []).flatMap((m) => {
    const ev = m.events as { name: string; code: string } | null
    if (!ev) return []
    return [
      {
        eventId: m.event_id,
        eventName: ev.name,
        eventCode: ev.code,
        role: m.role,
      },
    ]
  })

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
  timing.mark('admin-events')

  const viewer: Viewer = {
    userId: user.id,
    email: user.email ?? null,
    fullName: profile?.full_name ?? null,
    isAdmin,
    memberships,
  }
  timing.report()
  return viewer
}

/** Resolve an event by its short code, or null if the viewer cannot see it. */
export async function getEventByCode(code: string) {
  return perRequest(`event:${code}`, async () => {
    const key = `event:${code}:${await sessionScope()}`
    const hit = PERF_BASELINE ? undefined : eventCache.get(key)
    if (hit !== undefined) return hit as Awaited<ReturnType<typeof getEventByCodeUncached>>

    const row = await getEventByCodeUncached(code)
    // Only cache a hit. Caching a miss would make a freshly created event 404
    // for 30s, and a miss is the more sensitive of the two answers.
    if (row) eventCache.set(key, row)
    return row
  })
}

async function getEventByCodeUncached(code: string) {
  const timing = phaseTiming('route :: resolveEventByCode')
  const supabase = await createClient()
  timing.mark('client-create')
  const { data } = await supabase
    .from('events')
    .select('*')
    .eq('code', code)
    .maybeSingle()
  timing.mark('request')
  timing.report()
  return data
}

/**
 * `getEventByCode` with a case-insensitive retry.
 *
 * Codes are short slugs like SHARMA26. Accept a lower-cased URL rather than
 * 404ing on someone who typed it by hand — then render every link from the
 * canonical `event.code`, so the URL self-corrects on the next tap.
 */
export async function resolveEventByCode(code: string) {
  const exact = await getEventByCode(code)
  if (exact) return exact

  const upper = code.toUpperCase()
  if (upper === code) return null

  return getEventByCode(upper)
}

/**
 * Resolve the viewer's role on one event, computed from exactly the three
 * inputs `app.is_staff()` uses: `profiles.global_role`, `profiles.is_active`
 * and `event_members.role`. All are readable-by-self under RLS
 * (`profiles_sel` permits `id = auth.uid()`), so this answer matches the
 * database's — including for a deactivated admin, for whom `app.is_admin()`
 * is false.
 *
 * This exists because RLS makes "you are not staff" and "there is no data"
 * indistinguishable at the query layer — a `client` reading `guest_groups`
 * gets zero rows and no error. Anything that would otherwise present an
 * empty result as fact (the import preview above all) has to ask this first.
 *
 * It is still NOT the authorisation boundary — RLS is. Use it to tell the
 * user the truth, never to decide whether a write is allowed.
 */
export async function getEventAccess(eventId: string): Promise<EventAccess> {
  // Memoised per request per event: the layout resolves access for the nav,
  // then requireStaff/requireAdmin resolves it again inside the page.
  // 'none' is a real answer (not nullish), so it caches — correctly: it cannot
  // change within one request.
  return perRequest(`access:${eventId}`, () => getEventAccessUncached(eventId))
}

async function getEventAccessUncached(eventId: string): Promise<EventAccess> {
  const timing = phaseTiming('route :: getEventAccess')
  // Code-auth session (team/client) — the claims carry the role and event.
  const claims = await getSessionClaims()
  timing.mark('claims')
  if (claims) {
    if (claims.eventId !== eventId) return 'none'
    return claims.appRole === 'team' ? 'event_team' : 'client'
  }

  // GoTrue session (admin) — resolve via profiles/event_members.
  const supabase = await createClient()
  timing.mark('client-create')

  const {
    data: { user },
  } = await supabase.auth.getUser()
  timing.mark('getUser')
  if (!user) return 'none'

  const [{ data: profile }, { data: member }] = await Promise.all([
    supabase
      .from('profiles')
      .select('global_role, is_active')
      .eq('id', user.id)
      .maybeSingle(),
    supabase
      .from('event_members')
      .select('role')
      .eq('event_id', eventId)
      .eq('user_id', user.id)
      .maybeSingle(),
  ])
  timing.mark('profile+membership')

  // Both halves of `app.is_admin()`. A deactivated admin falls through to
  // their `event_members` row — usually none, so 'none' — which is exactly
  // what the database would answer.
  let result: EventAccess
  if (profile?.global_role === 'admin' && profile.is_active) result = 'admin'
  else if (member?.role === 'event_team') result = 'event_team'
  else if (member?.role === 'client') result = 'client'
  else result = 'none'
  timing.report()
  return result
}

/** admin or event_team on this event — i.e. `app.is_staff(event_id)`. */
export async function isEventStaff(eventId: string): Promise<boolean> {
  const access = await getEventAccess(eventId)
  return access === 'admin' || access === 'event_team'
}

/**
 * Page guard: this screen is for event staff.
 *
 * Call it at the top of the page body, once the event has been resolved:
 *
 *     const access = await requireStaff(event.id, event.code)
 *
 * It lives in the PAGE rather than the layout on purpose. A server layout
 * cannot see the current pathname, and reading `headers()` to sniff it opts
 * the whole subtree out of static rendering and breaks differently on every
 * Next release. The layout resolves access once for the nav; the page
 * resolves it again for the gate. That is two indexed single-row reads —
 * cheaper than being wrong.
 *
 * This is a UX affordance, not the security boundary. RLS is the fence: a
 * client who defeats this redirect still reads zero rows from every staff
 * table. What it buys is honesty — under RLS "you may not" and "there is no
 * data" both come back as an empty result, so a client left on a staff screen
 * would be shown a confident, fabricated "0 families". Redirect instead.
 */
export async function requireStaff(
  eventId: string,
  eventCode: string,
): Promise<StaffAccess> {
  const access = await getEventAccess(eventId)
  if (access === 'admin' || access === 'event_team') return access

  // A client belongs on exactly one page in this event.
  if (access === 'client') redirect(`/${eventCode}/guests`)

  // Unreachable in practice: `getEventByCode` already returned null for a
  // non-member, so the layout 404'd before we got here. Kept so the
  // invariant is written down rather than assumed.
  notFound()
}

/**
 * Page guard: this screen is for admins only.
 *
 * Note what this is NOT: RLS would happily let an `event_team` member insert
 * `import_batches`, `import_rows` and `guest_groups`. This restriction is a
 * product decision layered above the database ("import lives on an admin-only
 * route"), not a security boundary. Relaxing it later is one word in one file
 * — swap `requireAdmin` for `requireStaff` on the import page — and needs no
 * migration.
 */
export async function requireAdmin(
  eventId: string,
  eventCode: string,
  /** Names the screen that was refused, so the dashboard can explain the bounce. */
  deniedReason: DeniedReason = 'admin',
): Promise<'admin'> {
  const access = await getEventAccess(eventId)
  if (access === 'admin') return access

  if (access === 'client') redirect(`/${eventCode}/guests`)

  // Staff, just not admin: send them to the screen they do own rather than
  // stranding them on a page with nothing on it — and SAY SO when they get
  // there. A silent bounce reads as a bug ("I tapped the link the team sent
  // and it threw me back"), so the dashboard renders a note for `?denied`.
  if (access === 'event_team') redirect(`/${eventCode}?denied=${deniedReason}`)

  notFound()
}
