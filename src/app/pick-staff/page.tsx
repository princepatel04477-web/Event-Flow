import Link from 'next/link'
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
            ? 'No names on this event yet. Nothing is blocked — writes work either way since migration 20260814140000 — but they will not record who made them. Add names from the admin screen if you want that.'
            : 'Your event admin has not added staff names yet. Nothing is blocked: go back and carry on. If you want your work recorded under your name, ask whoever gave you this code to add you.'
        }
        action={
          // Everyone gets a way forward. This screen used to be a hard stop
          // for a non-admin — no names, no button, no route on — back when a
          // staff identity was required to write anything. It is optional now,
          // so leaving a dead end here would strand the one person who cannot
          // fix it: the staff member on the floor.
          <div className="flex w-full flex-col gap-2">
            {isAdmin ? (
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
                <Button type="submit" size="lg" fullWidth>
                  Add staff members
                </Button>
              </form>
            ) : null}
            <Link
              href={`/${event.code}`}
              className="tap flex min-h-12 w-full items-center justify-center rounded-2xl border border-rule text-sm font-semibold text-muted active:bg-surface-2"
            >
              Continue without a name
            </Link>
          </div>
        }
      />
    )
  }

  return <StaffPicker members={members} eventCode={event.code} />
}
