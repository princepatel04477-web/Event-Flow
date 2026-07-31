import { notFound, redirect } from 'next/navigation'
import type { ReactNode } from 'react'

import { SignOutButton } from '@/components/auth/SignOutButton'
import { AdminLink } from '@/components/nav/AdminLink'
import { BottomTabs } from '@/components/nav/BottomTabs'
import { EventSwitcher } from '@/components/nav/EventSwitcher'
import { StickyHeader } from '@/components/ui/StickyHeader'
import { getEventAccess, getViewer, resolveEventByCode } from '@/lib/supabase/queries'
import { cn, formatDateRange } from '@/lib/utils'

type LayoutProps = {
  children: ReactNode
  // Next 15+ hands params over as a Promise.
  params: Promise<{ eventCode: string }>
}

export default async function EventLayout({ children, params }: LayoutProps) {
  const { eventCode } = await params

  const [viewer, event] = await Promise.all([
    getViewer(),
    resolveEventByCode(eventCode),
  ])

  if (!viewer) {
    redirect(`/login?next=${encodeURIComponent(`/${eventCode}`)}`)
  }

  // getEventByCode runs under RLS. No row means "this code does not exist"
  // OR "you are not a member of it" — indistinguishable on purpose, and a
  // 404 is the right answer to both.
  if (!event) notFound()

  // Resolved once here, for the nav. The per-page gate (requireStaff /
  // requireAdmin) resolves it again inside each page, because a server layout
  // cannot see the pathname and sniffing headers() to fake it would opt this
  // whole subtree out of static rendering.
  const access = await getEventAccess(event.id)

  // Belt and braces: getEventByCode already returned null for a non-member,
  // so this cannot fire. It documents the invariant rather than assuming it.
  if (access === 'none') notFound()

  // A client gets no tab bar (see BottomTabs), so nothing needs clearing at
  // the bottom of the page — just the gesture bar.
  const showTabs = access !== 'client'

  const subtitle =
    formatDateRange(event.starts_on, event.ends_on) ?? event.venue_city ?? event.code

  return (
    <>
      <StickyHeader
        title={event.name}
        subtitle={subtitle}
        right={
          <>
            {viewer.memberships.length > 1 ? (
              // Full memberships, not a projection: the switcher needs each
              // event's role so it can send a client to their guests page
              // rather than to a dashboard they will be bounced off.
              <EventSwitcher
                events={viewer.memberships}
                currentCode={event.code}
                isAdmin={viewer.isAdmin}
              />
            ) : null}
            <AdminLink show={viewer.isAdmin} />
            <SignOutButton compact />
          </>
        }
      />

      {/* Two elements on purpose: the safe-area inset and the content gutter
          are both horizontal padding, so they cannot share a box. The bottom
          inset lives on <main> for the same reason — pb-safe and pb-8 are the
          same property and would fight on one element. */}
      <main className={cn('flex-1 px-safe', !showTabs && 'pb-safe')}>
        <div
          className={cn(
            'mx-auto w-full max-w-[480px] px-4 pt-4',
            showTabs ? 'pb-nav' : 'pb-8',
          )}
        >
          {children}
        </div>
      </main>

      <BottomTabs eventCode={event.code} access={access} />
    </>
  )
}
