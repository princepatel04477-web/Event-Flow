import type { Database } from '@/lib/supabase/database.types'

/**
 * Event identity and routing, isolated from anything that touches Supabase.
 *
 * This file exists ONLY so `eventHomePath()` can be called from a client
 * component. It used to live in `@/lib/supabase/queries`, which starts with
 * `import 'server-only'` — importing it from the event switcher would have
 * failed the build, and the switcher therefore hard-coded `/{code}` for every
 * role. `@/lib/supabase/queries` re-exports everything here, so existing
 * server imports are unchanged.
 *
 * Keep this module free of I/O. The moment it needs a database it belongs in
 * queries.ts instead.
 */

export type EventRole = Database['app']['Enums']['event_role']
export type GlobalRole = Database['app']['Enums']['global_role']

export type Membership = {
  eventId: string
  eventName: string
  eventCode: string
  /**
   * The `event_members.role` for this event — 'event_team' or 'client'.
   *
   * TRAP: for an admin this is FABRICATED. Admins hold no `event_members`
   * rows, so `getViewer()` lists every event and reports 'event_team' for
   * all of them. `app.event_role` has no 'admin' value and inventing one
   * would not match the database. So `role === 'client'` only means what it
   * says when `viewer.isAdmin` is false — check `isAdmin` first, or use
   * `eventHomePath()`, which already does.
   */
  role: EventRole
}

/**
 * Where this membership's owner should land when they open the event.
 *
 * A client can only read `client_guest_profiles`, so their home is the guests
 * page, not the dashboard. Sending them to `/{code}` would render a staff
 * screen for one frame and then bounce — a visible flash for no gain.
 *
 * Reads `isAdmin` first because `Membership.role` is fabricated for admins;
 * see the note on that field.
 */
export function eventHomePath(
  membership: Pick<Membership, 'eventCode' | 'role'>,
  isAdmin: boolean,
): string {
  if (!isAdmin && membership.role === 'client') {
    return eventGuestsPath(membership.eventCode)
  }
  return `/${membership.eventCode}`
}

/**
 * The one page a client may read in an event.
 *
 * A named helper rather than an inline template because the staff and admin
 * guards both bounce a client here, and M2 turns `[eventCode]` from a route
 * segment into a query param (UUIDs and tenant slugs cannot be enumerated by
 * generateStaticParams). When that lands, this function changes and the guards
 * do not.
 */
export function eventGuestsPath(eventCode: string): string {
  return `/${eventCode}/guests`
}

/**
 * The event dashboard, carrying the reason a guard refused a screen.
 *
 * `denied` is a closed union, never free text: it lands in a URL and the
 * dashboard looks the message up from a table rather than rendering whatever
 * the query string says. Nobody gets to inject a sentence into the app's own
 * voice.
 *
 * The bounce SAYS SO on arrival on purpose. A silent redirect reads as a bug
 * ("I tapped the link the team sent and it threw me back").
 */
export function eventDeniedPath(eventCode: string, reason: 'import' | 'admin'): string {
  return `/${eventCode}?denied=${reason}`
}
