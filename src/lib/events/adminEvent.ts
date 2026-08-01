import 'server-only'

import { createClient } from '@/lib/supabase/server'

/**
 * Resolving which event an admin screen is looking at.
 *
 * The `(admin)` route group deliberately sits above the `/{eventCode}`
 * tenancy segment — it lists every event rather than living inside one — so
 * event-scoped admin screens carry the event in `?event=CODE` instead.
 *
 * The layout has already established `global_role = 'admin'`. This is not a
 * second authorisation gate: RLS on `events` is `select using
 * app.is_member(id)`, so a non-admin who reached the URL would simply see
 * their own events and rows to match.
 */

export interface AdminEventOption {
  id: string
  name: string
  code: string
}

export interface AdminEventResolution {
  events: AdminEventOption[]
  selected: AdminEventOption | null
  error: string | null
}

export async function resolveAdminEvent(code: string | undefined): Promise<AdminEventResolution> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('events')
    .select('id, name, code')
    .order('created_at', { ascending: false })

  if (error) {
    return { events: [], selected: null, error: error.message }
  }

  const events = data ?? []
  // A single event needs no picker — going straight in is what someone
  // running one wedding expects.
  const selected = code
    ? (events.find((e) => e.code === code) ?? null)
    : events.length === 1
      ? events[0]
      : null

  return { events, selected, error: null }
}
