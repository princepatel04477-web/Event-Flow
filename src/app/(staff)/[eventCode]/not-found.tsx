'use client'

import { usePathname } from 'next/navigation'

import { InboxIcon } from '@/components/icons'
import { EmptyState } from '@/components/ui/EmptyState'
import { LinkButton } from '@/components/ui/LinkButton'

/**
 * Catches `notFound()` thrown by a page INSIDE an event — a stale group id in
 * a forwarded call link, a review extraction that was already applied.
 *
 * It renders inside the event layout, so the header and (for staff) the tab
 * bar stay put. That matters most for a client, who gets no tab bar at all:
 * dropped on Next's built-in 404 they would have no route back except the URL
 * bar, which does not exist inside the Capacitor APK shell.
 *
 * A client component only because `not-found.tsx` receives no `params` — the
 * event code has to come from the pathname to build a link home. A code the
 * layout did not accept never reaches this file, so the first segment is
 * always a real event.
 *
 * A bad event CODE is a different case: the layout itself calls `notFound()`,
 * and a boundary cannot catch a throw from the layout it lives under. That
 * one lands on the root `not-found.tsx`.
 */
export default function EventNotFound() {
  const pathname = usePathname()
  const eventCode = pathname.split('/').filter(Boolean)[0] ?? ''

  return (
    <EmptyState
      icon={<InboxIcon className="h-7 w-7" />}
      title="That page is not here"
      description="The link may be out of date, or the family it pointed at has moved. Nothing has gone wrong with your account."
      action={
        eventCode ? (
          <LinkButton href={`/${eventCode}`} fullWidth variant="secondary">
            Back to the event
          </LinkButton>
        ) : (
          <LinkButton href="/" fullWidth variant="secondary">
            Back to events
          </LinkButton>
        )
      }
    />
  )
}
