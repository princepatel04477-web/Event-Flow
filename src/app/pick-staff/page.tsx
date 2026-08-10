import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { getSessionClaims } from '@/lib/auth/server'
import { getViewer } from '@/lib/supabase/queries'
import { StaffPicker } from './StaffPicker'
import { Button } from '@/components/ui/Button'
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

  const supabase = await createClient()

  // Resolve the event code from the claims' event id.
  const { data: event } = await supabase
    .from('events')
    .select('code')
    .eq('id', claims.eventId)
    .maybeSingle()

  if (!event) redirect('/')

  const [{ data: members, error }, viewer] = await Promise.all([
    supabase
      .from('staff_members')
      .select('id, full_name, is_active')
      .eq('event_id', claims.eventId)
      .eq('is_active', true)
      .order('full_name', { ascending: true }),
    getViewer(),
  ])

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
    const isAdmin = viewer?.isAdmin === true
    return (
      <EmptyState
        icon={<UserIcon className="h-7 w-7" />}
        title="No staff on this event yet"
        description={
          isAdmin
            ? 'There are no team members assigned to this event yet. Add at least one from the admin screen before anyone can write data.'
            : 'Your event admin has not added staff names yet. Ask whoever gave you this code to add you. Once a name is on the list, refreshing this page will let you pick it.'
        }
        action={
          isAdmin ? (
            <form
              action={async () => {
                'use server'
                const supabase2 = await createClient()
                const { data: ev } = await supabase2
                  .from('events')
                  .select('code')
                  .eq('id', claims.eventId)
                  .maybeSingle()
                if (ev) redirect(`/admin/events/${ev.code}/staff`)
              }}
            >
              <Button type="submit" size="lg">
                Add staff members
              </Button>
            </form>
          ) : undefined
        }
      />
    )
  }

  return <StaffPicker members={members} eventCode={event.code} />
}
