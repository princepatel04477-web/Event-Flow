import { notFound, redirect } from 'next/navigation'
import type { ReactNode } from 'react'

import { UndoBar } from '@/components/ui/UndoBar'
import { getStaffViewerContext } from '@/lib/auth/section-guard'
import { getSessionClaims } from '@/lib/auth/server'
import { bottomTabsFor } from '@/lib/sections/config'
import { getEventAccess, getViewer, resolveEventByCode } from '@/lib/supabase/queries'
import { cn } from '@/lib/utils'

import { AppHeader } from './_components/AppHeader'
import { AppTabs } from './_components/AppTabs'
import { FirstRunCards } from './_components/FirstRunCards'

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

  // Ask the same function the bar itself asks. A client gets no bar, and
  // neither does a runner whose department is a single screen (Hampers,
  // Setup) — so `pb-nav` would reserve 56px of clearance under a page with
  // nothing beneath it.
  //
  // Resolved ONCE, here, and handed to the bar below. The bar renders this list
  // rather than calling `bottomTabsFor` a second time, so the clearance and the
  // bar cannot disagree even in principle — which is the bug this line was
  // written to fix in v1. Passing it down also means the tab SET still comes
  // from the shared config, while only the DESTINATIONS are remapped for the
  // new UI (Calls → `rsvp/queue`, not its legacy default `rsvp/campaigns`) by
  // `tabHrefFor` inside AppTabs.
  const tabs = bottomTabsFor(event.code, access, department)
  const showTabs = tabs.length > 0

  // Where "Skip" and "Start working" on the first-run cards put a runner back.
  // The FIRST tab is the shell's own answer to "where does this person work",
  // which is a real answer for every viewer: an event lead's first tab is Home,
  // a logistics runner's is Arrivals, and a hamper runner — who has no bar at
  // all — still resolves to `/{event}/hamper` rather than to the dashboard that
  // would bounce them straight back off it.
  const homeHref = tabs[0]?.href ?? `/${event.code}`

  return (
    // The skin is a property of WHO IS LOOKING, not of an OS setting.
    // Staff get the warm ivory ground they work on in corridors and car
    // parks; a client gets warm cream paper. `data-theme` re-points the same
    // token names (see globals.css).
    <div
      data-theme={access === 'client' ? 'client' : undefined}
      className="flex min-h-dvh flex-col bg-paper text-ink"
    >
      {/* NO OFFLINE BANNER HERE, DELIBERATELY. The root layout renders it, once,
          on every route — this shell used to render a second one and the root
          layout skipped its own under v2, which cost `/login`, `/pick-staff` and
          `/admin/**` their banner. The extra sentence this surface wants is
          passed to that banner from the root layout; see `src/lib/offline-note.ts`
          and the comment there. */}

      <AppHeader
        event={{ name: event.name, code: event.code }}
        viewer={effectiveViewer}
        // The cheat sheet describes the bottom bar, so it is offered exactly
        // where there is a bar to describe. A client has none and the route
        // would bounce them anyway.
        showHelp={access !== 'client'}
      />

      {/* Content column: safe-area insets, max 480px, single nav row at bottom */}
      <main className={cn('flex flex-1 flex-col px-safe', !showTabs && 'pb-safe')}>
        <div
          className={cn(
            'mx-auto flex w-full min-w-0 max-w-[480px] flex-1 flex-col overflow-x-hidden px-4 pt-4',
            showTabs ? 'pb-nav' : 'pb-8',
          )}
        >
          {children}
        </div>
      </main>

      <AppTabs tabs={tabs} />

      {/* Undo bar mounted in the shell for global 7-second cross-screen undo capability */}
      <UndoBar />

      {/* The three first-run cards. Last in the tree and `fixed inset-0 z-50`,
          so they paint over the whole shell including the bar and the undo
          strip, and they render NOTHING once the device has answered "already
          seen" — see FirstRunCards and device-flags for why the answer is read
          before anything is drawn.

          Offered only to staff, and only where the card copy is true: these
          three lines are addressed to someone who opens the app to work, and a
          client's app has no Home tab to speak of. An admin sees them too —
          they are the people who answer the question "how does this work". */}
      {access !== 'client' ? <FirstRunCards doneHref={homeHref} /> : null}
    </div>
  )
}
