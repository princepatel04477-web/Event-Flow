import 'server-only'

import { notFound, redirect } from 'next/navigation'

import { createClient } from './server'

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

export type Viewer = {
  userId: string
  email: string | null
  fullName: string | null
  isAdmin: boolean
  memberships: Membership[]
}

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
  const supabase = await createClient()

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

  return {
    userId: user.id,
    email: user.email ?? null,
    fullName: profile?.full_name ?? null,
    isAdmin,
    memberships,
  }
}

/** Resolve an event by its short code, or null if the viewer cannot see it. */
export async function getEventByCode(code: string) {
  const supabase = await createClient()
  const { data } = await supabase
    .from('events')
    .select('*')
    .eq('code', code)
    .maybeSingle()
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

/** What `app.is_staff()` / `app.is_member()` would answer for this viewer. */
export type EventAccess = 'admin' | 'event_team' | 'client' | 'none'

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
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
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

  // Both halves of `app.is_admin()`. A deactivated admin falls through to
  // their `event_members` row — usually none, so 'none' — which is exactly
  // what the database would answer.
  if (profile?.global_role === 'admin' && profile.is_active) return 'admin'
  if (member?.role === 'event_team') return 'event_team'
  if (member?.role === 'client') return 'client'
  return 'none'
}

/** admin or event_team on this event — i.e. `app.is_staff(event_id)`. */
export async function isEventStaff(eventId: string): Promise<boolean> {
  const access = await getEventAccess(eventId)
  return access === 'admin' || access === 'event_team'
}

/** The two values `app.is_staff(event_id)` answers true for. */
export type StaffAccess = Extract<EventAccess, 'admin' | 'event_team'>

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
 * Why `requireAdmin` bounced someone, carried to the dashboard as `?denied=`.
 *
 * A closed union rather than free text: it lands in a URL, and the dashboard
 * looks the message up from a table instead of rendering whatever the query
 * string says. Nobody gets to inject a sentence into the app's own voice.
 */
export type DeniedReason = 'import' | 'admin'

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
