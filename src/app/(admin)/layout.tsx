import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'

import { SignOutButton } from '@/components/auth/SignOutButton'
import { ScreenHeader } from '@/components/ui/ScreenHeader'
import { AdminSidebar } from './AdminSidebar'
import { AdminMobileNav } from './AdminMobileNav'
import { getViewer } from '@/lib/supabase/queries'

/**
 * Shell for the admin-only screens.
 *
 * Administrators manage everything from a laptop — sidebar on wide viewports,
 * bottom tab bar on phones. The guard runs here so a non-admin never receives
 * the admin markup at all.
 *
 * Every admin screen carries the current event's name and a switcher. An admin
 * sees ALL events, and editing the wrong wedding is the single most dangerous
 * mistake on this panel — make the context impossible to miss.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const viewer = await getViewer()

  if (!viewer) redirect('/login')
  if (!viewer.isAdmin) redirect('/')

  return (
    <div className="flex min-h-dvh flex-col bg-paper text-ink">
      {/* The v3 screen title: a small muted context line over a 30px Bricolage
          title. The signed-in identity is the context line — it is what the
          old `StickyHeader` subtitle carried — and it no longer competes with
          the title for the same 40px.

          `search={false}`: `ScreenHeader` derives its round Find button from
          the path's first segment, which on every admin route is `admin`, so
          the default would render a link to `/admin/find` — a route that does
          not exist. Admin has no Find; the button is switched off rather than
          left pointing at a 404. */}
      <ScreenHeader
        title="Admin"
        context={viewer.fullName ?? viewer.email ?? 'Signed in'}
        backHref="/"
        backLabel="App"
        search={false}
        actions={<SignOutButton compact />}
      />

      <div className="flex flex-1">
        {/* Sidebar — visible on md+ only */}
        <AdminSidebar viewer={viewer} />

        {/* Content */}
        <div className="flex min-w-0 flex-1 flex-col">
          <main className="flex-1 px-safe">
            {/* pb-nav, not pb-safe. AdminMobileNav is `fixed bottom-0` with
                min-h-16 rows, so on a phone the last ~64px of every admin
                page sits underneath it. pb-safe only clears the gesture bar,
                which is 0px on most Androids, so it cleared nothing.

                That is not cosmetic: the last element on /admin/events is the
                "Create event" submit, so an admin on a handset could scroll to
                the bottom and still not reach it — there was nothing below it
                to scroll past. Creating an event was impossible on a phone.
                The staff shell already solved this with pb-nav; admin just
                never adopted it. */}
            <div className="mx-auto w-full max-w-[480px] px-4 pt-4 pb-nav md:max-w-none md:pb-8">
              {children}
            </div>
          </main>
        </div>
      </div>

      {/* Bottom nav — visible on mobile only */}
      <AdminMobileNav />
    </div>
  )
}
