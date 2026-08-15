import { notFound, redirect } from 'next/navigation'
import type { ReactNode } from 'react'

import { SignOutButton } from '@/components/auth/SignOutButton'
import { AdminLink } from '@/components/nav/AdminLink'
import { BottomTabs } from '@/components/nav/BottomTabs'
import { SectionTabs } from '@/components/nav/SectionTabs'
import { EventSwitcher } from '@/components/nav/EventSwitcher'
import { StickyHeader } from '@/components/ui/StickyHeader'
import { getSessionClaims } from '@/lib/auth/server'
import { getEventAccess, getViewer, resolveEventByCode } from '@/lib/supabase/queries'
import { cn, formatDateRange } from '@/lib/utils'

type LayoutProps = {
  children: ReactNode
  // Next 15+ hands params over as a Promise.
  params: Promise<{ eventCode: string }>
}

export default async function EventLayout({ children, params }: LayoutProps) {
  const { eventCode } = await params

  const [viewer, event, codeClaims] = await Promise.all([
    getViewer(),
    resolveEventByCode(eventCode),
    getSessionClaims(),
  ])

  // A code-auth (team/client) session has no GoTrue viewer — getViewer()
  // returns null for it because the code cookie is not visible in this render
  // scope. The claims ARE the identity: build the nav data from them so staff
  // are not bounced to /login. An admin has no claims and uses getViewer().
  const isCodeSession = codeClaims !== null
  const effectiveViewer = viewer ?? (isCodeSession ? {
    userId: codeClaims.accessCodeId,
    email: null,
    fullName: codeClaims.staffMemberId ?? null,
    isAdmin: false,
    memberships: event
      ? [{ eventId: codeClaims.eventId, eventName: event.name, eventCode: event.code, role: (codeClaims.appRole === 'team' ? 'event_team' : 'client') as 'event_team' | 'client' }]
      : [],
  } : null)

  if (!effectiveViewer) {
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
    // The skin is a property of WHO IS LOOKING, not of an OS setting.
    // Staff get the night-teal ground they work on in corridors and car
    // parks; a client — reading this in a hotel lobby in daylight, and
    // often the oldest user of the app — gets warm paper. `data-theme`
    // re-points the same token names (see globals.css), so nothing below
    // this line branches on the role to get its colours right.
    <div
      data-theme={access === 'client' ? 'client' : undefined}
      className="flex min-h-dvh flex-col bg-paper text-ink"
    >
      <StickyHeader
        title={event.name}
        subtitle={subtitle}
        right={
          <nav className="flex items-center gap-2" aria-label="Header actions">
            {effectiveViewer.memberships.length > 1 ? (
              // Full memberships, not a projection: the switcher needs each
              // event's role so it can send a client to their guests page
              // rather than to a dashboard they will be bounced off.
              <EventSwitcher
                events={effectiveViewer.memberships}
                currentCode={event.code}
                isAdmin={effectiveViewer.isAdmin}
              />
            ) : null}
            <AdminLink show={effectiveViewer.isAdmin} />
            <span className="ml-0.5 border-l border-rule-strong pl-2.5">
              <SignOutButton compact />
            </span>
          </nav>
        }
      />

      {/* Two elements on purpose: the safe-area inset and the content gutter
          are both horizontal padding, so they cannot share a box. The bottom
          inset lives on <main> for the same reason — pb-safe and pb-8 are the
          same property and would fight on one element. */}
      <main className={cn('flex flex-1 flex-col px-safe', !showTabs && 'pb-safe')}>
        <div
          className={cn(
            'mx-auto flex w-full max-w-[480px] flex-1 flex-col px-4 pt-4',
            showTabs ? 'pb-nav' : 'pb-8',
          )}
        >
          {/* The second navigation level. Renders nothing for a section with
              fewer than two reachable children, so most screens are unchanged
              — see SectionTabs. */}
          <SectionTabs eventCode={event.code} access={access} />
          {children}
        </div>
      </main>

      <BottomTabs eventCode={event.code} access={access} />
    </div>
  )
}
