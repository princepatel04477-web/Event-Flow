import type { Membership } from '@/lib/events/paths'

/**
 * Types shared by the server guards (queries.ts) and their client ports
 * (queries-client.ts).
 *
 * Split out for the same reason as claims-types.ts: queries.ts carries
 * `import 'server-only'`, so a client component cannot import from it even for
 * a type. Types only in here — nothing importable from this file can reach a
 * cookie, a secret, or the server client.
 */

export type Viewer = {
  userId: string
  email: string | null
  fullName: string | null
  isAdmin: boolean
  memberships: Membership[]
}

/** What `app.is_staff()` / `app.is_member()` would answer for this viewer. */
export type EventAccess = 'admin' | 'event_team' | 'client' | 'none'

/** The two values `app.is_staff(event_id)` answers true for. */
export type StaffAccess = Extract<EventAccess, 'admin' | 'event_team'>

/**
 * Why an admin guard bounced someone, carried to the dashboard as `?denied=`.
 *
 * A closed union rather than free text: it lands in a URL, and the dashboard
 * looks the message up from a table instead of rendering whatever the query
 * string says. Nobody gets to inject a sentence into the app's own voice.
 */
export type DeniedReason = 'import' | 'admin'
