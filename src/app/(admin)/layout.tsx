import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'

import { SignOutButton } from '@/components/auth/SignOutButton'
import { StickyHeader } from '@/components/ui/StickyHeader'
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
    <div className="flex min-h-dvh flex-col bg-bg">
      <StickyHeader
        title="Admin"
        subtitle={viewer.fullName ?? viewer.email ?? 'Signed in'}
        backHref="/"
        backLabel="App"
        right={<SignOutButton compact />}
      />

      <div className="flex flex-1">
        {/* Sidebar — visible on md+ only */}
        <AdminSidebar viewer={viewer} />

        {/* Content */}
        <div className="flex min-w-0 flex-1 flex-col">
          <main className="flex-1 px-safe">
            <div className="mx-auto w-full max-w-[480px] px-4 pt-4 pb-safe md:max-w-none md:pb-8">
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
