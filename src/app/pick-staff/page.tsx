import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { getSessionClaims } from '@/lib/auth/server'
import { StaffPicker } from './StaffPicker'
import { EmptyState } from '@/components/ui/EmptyState'
import { UserIcon } from '@/components/icons'

/**
 * The "Who are you?" step for team sessions.
 *
 * A shared team code attributes every write to the same session — that
 * would break delivery_proofs.delivered_by, the point of the proof
 * system. So after a valid team code, the caller picks their name from
 * the event's staff list (one tap, no password). The selection is stored
 * with the session; every write records it. Writes are blocked until a
 * staff member is selected.
 *
 * Client sessions skip this entirely — read-only, attribution irrelevant.
 */
export default async function PickStaffPage() {
  const claims = await getSessionClaims()

  if (!claims) redirect('/login')
  if (claims.appRole !== 'team') redirect('/')

  // Resolve the event code from the claims' event id (routes use codes).
  const supabase = await createClient()
  const { data: event } = await supabase
    .from('events')
    .select('code')
    .eq('id', claims.eventId)
    .maybeSingle()

  if (!event) redirect('/')

  const { data: members, error } = await supabase
    .from('staff_members')
    .select('id, full_name, is_active')
    .eq('event_id', claims.eventId)
    .eq('is_active', true)
    .order('full_name', { ascending: true })

  if (error) {
    return (
      <EmptyState
        icon={<UserIcon className="h-7 w-7" />}
        title="Could not load the staff list"
        description="The staff list did not come back from the database. Check your connection and try again."
      />
    )
  }

  if (!members || members.length === 0) {
    return (
      <EmptyState
        icon={<UserIcon className="h-7 w-7" />}
        title="No staff on this event yet"
        description="Your event admin has not added staff names yet. Ask them to add you, then sign in again."
      />
    )
  }

  return <StaffPicker members={members} eventCode={event.code} />
}
