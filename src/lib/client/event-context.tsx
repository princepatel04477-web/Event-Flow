'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

import { eventDeniedPath, eventGuestsPath } from '@/lib/events/paths'
import { getEventAccessClient, resolveEventByCodeClient } from '@/lib/supabase/queries-client'
import type { DeniedReason, EventAccess, StaffAccess } from '@/lib/supabase/queries-types'
import type { Database } from '@/lib/supabase/database.types'
import { useSession } from '@/lib/client/session-context'

/**
 * The current event and the viewer's access to it, resolved once per event.
 *
 * Replaces `resolveEventByCode` (124 call sites), `getEventAccess`,
 * `requireStaff` (93) and `requireAdmin` (15). Those were imperative page
 * guards that could `redirect()` mid-render because they ran on the server.
 * A client component cannot throw a redirect during render without tearing the
 * tree, so the shape changes: the provider resolves, and the `useRequire*`
 * hooks navigate from an effect and report a status the caller renders around.
 *
 * The access value is resolved ONCE here, for the whole subtree. The server
 * version resolved it in the layout for the nav and again in each page for the
 * gate — not from carelessness but because a server layout cannot see the
 * pathname, and reading headers() to sniff it opted the subtree out of static
 * rendering. A client provider has the pathname, so the second read is gone.
 */

export type EventRow = Database['public']['Tables']['events']['Row']

export type EventStatus =
  /** Resolving the event and access. Render a skeleton, never an empty state. */
  | 'loading'
  /** Resolved. `event` and `access` are non-null, `access` is not 'none'. */
  | 'ready'
  /**
   * No such event, or not visible to this viewer.
   *
   * Under RLS those are one answer, deliberately: `events` is fenced by
   * `is_member(id)`, so a non-member's read returns no row and cannot be told
   * apart from a code that does not exist. A 404 is the right response to both
   * — revealing which it was would leak that another tenant's event exists.
   */
  | 'not-found'

export type EventValue = {
  status: EventStatus
  event: EventRow | null
  access: EventAccess
}

const EventContext = createContext<EventValue | null>(null)

export function EventProvider({
  eventCode,
  children,
}: {
  eventCode: string
  children: ReactNode
}) {
  const session = useSession()
  const [value, setValue] = useState<EventValue>({
    status: 'loading',
    event: null,
    access: 'none',
  })

  useEffect(() => {
    // Wait for the session: resolving the event before the code-auth token is
    // in the fetch wrapper's cache sends an anonymous request, which RLS
    // answers with no row — indistinguishable from "no such event", so the
    // screen would 404 on a perfectly good session.
    if (session.status === 'loading') return

    let cancelled = false

    void (async () => {
      const event = await resolveEventByCodeClient(eventCode)
      if (cancelled) return

      if (!event) {
        setValue({ status: 'not-found', event: null, access: 'none' })
        return
      }

      const access = await getEventAccessClient(event.id)
      if (cancelled) return

      // Belt and braces: resolveEventByCodeClient already returned null for a
      // non-member, so 'none' here should be unreachable. Kept so the
      // invariant is written down rather than assumed.
      if (access === 'none') {
        setValue({ status: 'not-found', event: null, access: 'none' })
        return
      }

      setValue({ status: 'ready', event, access })
    })()

    return () => {
      cancelled = true
    }
  }, [eventCode, session.status])

  return <EventContext.Provider value={value}>{children}</EventContext.Provider>
}

/** The current event. Throws outside the provider — a wiring bug, not a state. */
export function useEvent(): EventValue {
  const value = useContext(EventContext)
  if (!value) throw new Error('useEvent must be used inside <EventProvider>')
  return value
}

/**
 * What a `useRequire*` hook resolved to.
 *
 * `allowed` is false while loading as well as when refused, so a caller that
 * only checks `allowed` fails safe — it renders the skeleton rather than the
 * guarded screen. Check `status` to tell the two apart.
 */
export type GuardResult = {
  status: EventStatus | 'refused'
  allowed: boolean
  event: EventRow | null
  access: EventAccess
}

/**
 * Screen guard: this page is for event staff.
 *
 * NOT the security boundary — RLS is the fence, and a client who defeats this
 * redirect still reads zero rows from every staff table. What it buys is
 * honesty: under RLS "you may not" and "there is no data" are the same empty
 * result, so a client left on a staff screen would be shown a confident,
 * fabricated "0 families".
 */
export function useRequireStaff(): GuardResult {
  const { status, event, access } = useEvent()
  const router = useRouter()

  const refused = status === 'ready' && access === 'client'

  useEffect(() => {
    if (!refused || !event) return
    // A client belongs on exactly one page in this event.
    router.replace(eventGuestsPath(event.code))
  }, [refused, event, router])

  const allowed = status === 'ready' && (access === 'admin' || access === 'event_team')
  return { status: refused ? 'refused' : status, allowed, event, access }
}

/**
 * Screen guard: this page is for admins only.
 *
 * Note what this is NOT: RLS would happily let an `event_team` member insert
 * `import_batches`, `import_rows` and `guest_groups`. This restriction is a
 * product decision layered above the database ("import lives on an admin-only
 * route"), not a security boundary. Relaxing it later is one word at one call
 * site and needs no migration.
 */
export function useRequireAdmin(deniedReason: DeniedReason = 'admin'): GuardResult {
  const { status, event, access } = useEvent()
  const router = useRouter()

  const refused = status === 'ready' && access !== 'admin'

  useEffect(() => {
    if (!refused || !event) return

    if (access === 'client') {
      router.replace(eventGuestsPath(event.code))
      return
    }

    // Staff, just not admin: send them to the screen they do own rather than
    // stranding them on a page with nothing on it — and say why when they
    // arrive.
    if (access === 'event_team') {
      router.replace(eventDeniedPath(event.code, deniedReason))
    }
  }, [refused, access, event, deniedReason, router])

  const allowed = status === 'ready' && access === 'admin'
  return { status: refused ? 'refused' : status, allowed, event, access }
}

export type { StaffAccess }
