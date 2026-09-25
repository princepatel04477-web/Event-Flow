import { notFound, redirect } from 'next/navigation'
import { Suspense, type ReactNode } from 'react'

import { UndoBar } from '@/components/ui/UndoBar'
import { LockedSectionBanner } from '@/components/LockedSectionBanner'
import { getStaffViewerContext } from '@/lib/auth/section-guard'
import { getSessionClaims } from '@/lib/auth/server'
import { v3TabsFor } from '@/lib/sections/v3'
import { sidebarGroupsFor } from '@/lib/sections/sidebar'
import { getEventAccess, getViewer, resolveEventByCode } from '@/lib/supabase/queries'
import { cn } from '@/lib/utils'

import { AppHeader } from './_components/AppHeader'
import { AppSidebar } from './_components/AppSidebar'
import { AppTabs } from './_components/AppTabs'
import { DeniedNote } from './_components/DeniedNote'

/* The offline training line that used to live here as a constant now lives in
   `src/lib/offline-note.ts`, because the banner that renders it is mounted by
   the ROOT layout rather than by this shell. See that file for why. */

type LayoutProps = {
  children: ReactNode
  // Next 15+ hands params over as a Promise.
  params: Promise<{ eventCode: string }>
}

export default async function AppEventLayout({ children, params }: LayoutProps) {
  const { eventCode } = await params

  // Provably identical guards to src/app/(staff)/[eventCode]/layout.tsx:
  // Both query getViewer(), resolveEventByCode(), and getSessionClaims() in parallel.
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
  const staffCtx = access === 'admin' || access === 'event_team'
    ? await getStaffViewerContext(event.id)
    : null
  const department = staffCtx?.department ?? null

  // Belt and braces: getEventByCode already returned null for a non-member,
  // so this cannot fire. It documents the invariant rather than assuming it.
  if (access === 'none') notFound()

  // The v3 bar: Today · Calls · Hospitality · Hampers · Logistics, per-department
  // filtering intact. This is deliberately NOT `bottomTabsFor`, which still
  // serves the v1 shell (`(staff)/[eventCode]/layout.tsx`) and its pinned
  // tests; the two models share the `SECTIONS` table underneath. See
  // `src/lib/sections/v3.ts` for the full "why".
  //
  // Resolved ONCE, here, and handed to the bar below. The bar renders this
  // list rather than resolving it a second time, so the clearance and the bar
  // cannot disagree even in principle — which is the bug this line was
  // written to fix in v1.
  const tabs = v3TabsFor(event.code, access, department)
  const showTabs = tabs.length > 0

  // The desktop sidebar (>= 1024px). Resolved from the SAME SECTIONS table as
  // the bar above, so the two cannot disagree about what this viewer may open.
  // Empty for a client — they get no nav, exactly as they get no bottom bar.
  const sidebar = sidebarGroupsFor(event.code, access, department)
  const showSidebar = sidebar.length > 0

  /**
   * How much room the page must leave at the bottom.
   *
   * A screen may mount a `BottomBar`, which is `fixed` above the tab bar and
   * therefore out of the flow. The layout cannot know whether one is on the
   * page (a server component cannot see its own children's contents), so the
   * reserved height is a floor, not the full answer: the bar overlaps the
   * LAST ~88px of content unless the screen also adds `pb-bottombar` (or
   * `pb-nav-bottombar`) to the element that scrolls. That is documented on
   * `BottomBar` itself and in the `_components/README.md`.
   *
   * With no tab bar (a client, a single-screen department) the old `pb-8`
   * stays: there is nothing fixed to clear.
   */
  const contentBottom = showTabs ? 'pb-nav' : 'pb-8'

  return (
    // The skin is a property of WHO IS LOOKING, not of an OS setting.
    // Staff get the warm paper ground they work on in corridors and car
    // parks; a client gets a brighter cream. `data-theme` re-points the same
    // token names (see globals.css).
    <div
      data-theme={access === 'client' ? 'client' : undefined}
      className={cn('flex min-h-dvh flex-col bg-paper text-ink', showSidebar && 'lg:pl-64')}
    >
      {/* NO OFFLINE BANNER HERE, DELIBERATELY. The root layout renders it,
          once, on every route, and only while the device is actually offline
          (`OfflineBanner` returns null otherwise) — so the v3 rule "keep ONE
          small offline pill, only when offline" is already satisfied by that
          one component. This shell used to render a second one. */}

      {showSidebar ? <AppSidebar groups={sidebar} /> : null}

      <AppHeader
        event={{
          name: event.name,
          code: event.code,
          startsOn: event.starts_on,
          endsOn: event.ends_on,
          venueCity: event.venue_city,
        }}
        viewer={effectiveViewer}
        // The cheat sheet describes the bottom bar, so it is offered exactly
        // where there is a bar to describe. It renders from inside Today now
        // (SPEC-V3 §3) rather than in the header; this prop carries the
        // server's answer about whether the viewer is staff.
        showHelp={access !== 'client'}
        // The guest list, import and export have no tab in the v3 bar — Find
        // replaced it — and the only other door was Today's empty-state card,
        // which stops rendering the moment the event has guests. This is the
        // reachable door (`docs/BUGS.md` M33), offered to the two roles
        // `SECTIONS.guests` admits.
        showGuests={access === 'admin' || department === 'management'}
      />

      {/* Content column: safe-area insets, max 480px, single nav row at bottom */}
      <main className={cn('flex flex-1 flex-col px-safe', !showTabs && 'pb-safe')}>
        <div
          className={cn(
            'mx-auto flex w-full min-w-0 max-w-[480px] flex-1 flex-col overflow-x-hidden px-4 pt-3',
            contentBottom,
            showSidebar && 'lg:mx-0 lg:max-w-none lg:px-8 lg:pb-8',
          )}
        >
          {/* A refused tap lands on the viewer's OWN department home, and says
              why. Rendered by the shell so every screen inherits it — the note
              used to live only inside Today, which a department runner never
              sees (`docs/BUGS.md` M3, M7). Suspense because it reads a query
              parameter. */}
          <Suspense fallback={null}>
            <DeniedNote />
          </Suspense>
          {/* Read-only section notice (A8), for the field team only. An admin
              is the one who set the lock and never needs telling. */}
          {access === 'event_team' ? (
            <LockedSectionBanner eventId={event.id} eventCode={event.code} />
          ) : null}
          {children}
        </div>
      </main>
      <AppTabs tabs={tabs} model="v3" />

      {/* Undo bar mounted in the shell for global 7-second cross-screen undo capability */}
      <UndoBar />

      {/* THE FIRST-RUN CARDS ARE GONE (v3 §3: "delete from staff screens:
          first-run cards"). They were three full-screen cards that painted
          over the whole shell on a device that had not seen them before —
          on the one launch where a runner most needs to see their queue, not
          a tour. The help screen still exists at /{event}/help and is
          reachable from the small link inside Today. `FirstRunCards.tsx`
          itself is left on disk and still compiles; nothing imports it. */}
    </div>
  )
}
