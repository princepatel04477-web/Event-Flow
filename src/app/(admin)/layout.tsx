import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'

import { SignOutButton } from '@/components/auth/SignOutButton'
import { AdminSidebar } from './AdminSidebar'
import { AdminHeader } from './AdminHeader'
import { getViewer } from '@/lib/supabase/queries'

/**
 * Shell for the admin-only screens.
 *
 * Administrators manage everything from a laptop — sidebar on wide viewports —
 * and, on a phone, from the event app's Control tab: the event layout below
 * this one draws the event's own tab bar with Control lit (UI4 Part S). The guard runs here so a non-admin never receives
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
      {/* UI4 Part S: the header names the TOOL and goes back to the event's
          Control tab. The old fixed "Admin" title with a back link labelled
          "App" is what made admin read as a second app on a phone. */}
      <AdminHeader
        context={viewer.fullName ?? viewer.email ?? 'Signed in'}
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
                never adopted it. The bar is now the event's own tab bar
                (drawn by the event layout), which is fixed in the same place. */}
            <div className="mx-auto w-full max-w-[480px] px-4 pt-4 pb-nav md:max-w-none md:pb-8">
              {children}
            </div>
          </main>
        </div>
      </div>

      {/* No admin tab bar. On a phone the event's own bar is drawn by
          `admin/events/[eventCode]/layout.tsx` with Control lit, so admin
          tools sit inside the one app (UI4 Part S). The old four-tab bar
          (Events · Dashboard · Msgs · More) and its More sheet are gone. */}
    </div>
  )
}
