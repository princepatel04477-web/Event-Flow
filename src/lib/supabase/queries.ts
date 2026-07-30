import 'server-only'

import { createClient } from './server'
import type { Database } from './database.types'

export type EventRole = Database['app']['Enums']['event_role']
export type GlobalRole = Database['app']['Enums']['global_role']

export type Membership = {
  eventId: string
  eventName: string
  eventCode: string
  role: EventRole
}

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
      .select('full_name, global_role')
      .eq('id', user.id)
      .maybeSingle(),
    supabase
      .from('event_members')
      .select('event_id, role, events(name, code)')
      .order('created_at', { ascending: true }),
  ])

  const isAdmin = profile?.global_role === 'admin'

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
