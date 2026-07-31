import Link from 'next/link'
import { redirect } from 'next/navigation'

import { SignOutButton } from '@/components/auth/SignOutButton'
import { ChevronLeftIcon, ShieldAlertIcon } from '@/components/icons'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { StickyHeader } from '@/components/ui/StickyHeader'
import { getViewer, type Membership } from '@/lib/supabase/queries'

/**
 * The front door.
 *
 * No session          -> /login
 * Exactly one event   -> straight into it, no extra tap
 * Several events      -> picker
 * None at all         -> a plain "ask an admin" screen. This is a normal
 *                        state for a newly created account, not an error.
 */
export default async function HomePage() {
  const viewer = await getViewer()
  if (!viewer) redirect('/login')

  const memberships = viewer.memberships

  if (memberships.length === 1) {
    redirect(`/${memberships[0].eventCode}`)
  }

  const who = viewer.fullName ?? viewer.email ?? 'Signed in'

  if (memberships.length === 0) {
    return (
      <div className="flex min-h-dvh flex-col bg-bg">
        <StickyHeader title="EventFlow" subtitle={who} right={<SignOutButton compact />} />
        <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
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
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <StickyHeader
        title="Choose an event"
        subtitle={who}
        right={<SignOutButton compact />}
      />

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-4">
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
        href={`/${membership.eventCode}`}
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
