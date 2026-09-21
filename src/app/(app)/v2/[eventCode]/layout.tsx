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

  return (
    // The skin is a property of WHO IS LOOKING, not of an OS setting.
    // Staff get the warm ivory ground they work on in corridors and car
    // parks; a client gets warm cream paper. `data-theme` re-points the same
    // token names (see globals.css).
    <div
      data-theme={access === 'client' ? 'client' : undefined}
      className="flex min-h-dvh flex-col bg-paper text-ink"
    >
      <AppHeader
        event={{ name: event.name, code: event.code }}
        viewer={effectiveViewer}
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
    </div>
  )
}
