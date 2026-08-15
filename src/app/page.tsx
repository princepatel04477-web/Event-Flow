import Link from 'next/link'
import { redirect } from 'next/navigation'

import { SignOutButton } from '@/components/auth/SignOutButton'
import { AdminLink } from '@/components/nav/AdminLink'
import { CalendarIcon, ChevronLeftIcon, ShieldAlertIcon } from '@/components/icons'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { LinkButton } from '@/components/ui/LinkButton'
import { StickyHeader } from '@/components/ui/StickyHeader'
import { eventHomePath, getViewer, type Membership } from '@/lib/supabase/queries'

/**
 * The front door.
 *
 * No session          -> /login
 * Exactly one event   -> straight into it, no extra tap
 * Several events      -> picker
 * None at all         -> an admin is offered the create-event screen;
 *                        anybody else gets "ask an admin". This is a normal
 *                        state for a newly created account, not an error.
 *
 * Every destination goes through `eventHomePath()`, which sends a client to
 * their guests page rather than to the dashboard. Landing a client on the
 * dashboard would work — the page guard bounces them — but they would watch
 * a staff screen flash past first.
 */
export default async function HomePage() {
  const viewer = await getViewer()
  if (!viewer) redirect('/login')

  const memberships = viewer.memberships

  if (memberships.length === 1) {
    redirect(eventHomePath(memberships[0], viewer.isAdmin))
  }

  const who = viewer.fullName ?? viewer.email ?? 'Signed in'

  if (memberships.length === 0) {
    return (
      <div className="flex min-h-dvh flex-col bg-bg">
        <StickyHeader
          title="EventFlow"
          subtitle={who}
          right={
            <>
              <AdminLink show={viewer.isAdmin} />
              <SignOutButton compact />
            </>
          }
        />
        <main className="mx-auto w-full max-w-[480px] flex-1 px-4 py-8">
          {viewer.isAdmin ? (
            // The bootstrap case (CLAUDE.md §7): migrations pushed, zero
            // events, one admin promoted from the SQL editor. RLS on `events`
            // is `using (app.is_member(id))`, which for an admin is true on
            // every row — so an empty list here genuinely means no event
            // exists, and this person is the one who can create it. Telling
            // them to "ask an event admin" would strand the only account that
            // can unblock the project.
            <EmptyState
              icon={<CalendarIcon className="h-7 w-7" />}
              title="No events yet"
              description="Nothing has been created on this database. Create the first wedding, then import its calling list."
              action={
                <LinkButton href="/admin/events" fullWidth>
                  Create the first event
                </LinkButton>
              }
            />
          ) : (
            <EmptyState
              icon={<ShieldAlertIcon className="h-7 w-7" />}
              title="You are not on an event yet"
              description={
                <>
                  Your account works, but nobody has added you to a wedding. Ask an event
                  admin to add <span className="font-medium text-fg">{viewer.email}</span>{' '}
                  to the event you are working on, then reload this page.
                </>
              }
            />
          )}
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <StickyHeader
        title="Choose an event"
        subtitle={who}
        right={
          <>
            <AdminLink show={viewer.isAdmin} />
            <SignOutButton compact />
          </>
        }
      />

      <main className="mx-auto w-full max-w-[480px] flex-1 px-4 py-4">
        <ul className="flex flex-col gap-3">
          {memberships.map((membership) => (
            <li key={membership.eventId}>
              <EventPickerRow membership={membership} isAdmin={viewer.isAdmin} />
            </li>
          ))}
        </ul>
      </main>
    </div>
  )
}

function EventPickerRow({
  membership,
  isAdmin,
}: {
  membership: Membership
  isAdmin: boolean
}) {
  return (
    <Card className="transition-colors hover:bg-surface-2">
      <Link
        href={eventHomePath(membership, isAdmin)}
        className="tap flex min-h-16 items-center gap-3 px-4 py-3"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-lg font-semibold text-fg">
            {membership.eventName}
          </span>
          <span className="mt-1 flex items-center gap-2">
            <Badge tone="neutral">{membership.eventCode}</Badge>
            <Badge tone={isAdmin ? 'info' : 'neutral'}>
              {isAdmin ? 'admin' : membership.role}
            </Badge>
          </span>
        </span>
        <ChevronLeftIcon className="h-6 w-6 shrink-0 rotate-180 text-muted" aria-hidden />
      </Link>
    </Card>
  )
}
