import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'

import { SignOutButton } from '@/components/auth/SignOutButton'
import { StickyHeader } from '@/components/ui/StickyHeader'
import { getViewer } from '@/lib/supabase/queries'

/**
 * Shell for the admin-only screens.
 *
 * The guard runs here, in a server component, so a non-admin never receives
 * the admin markup at all — no flash of a screen they cannot use, and nothing
 * a client-side check could be talked out of.
 *
 * It is still not the security boundary. `events` is fenced by
 * `insert/update/delete with check (app.is_admin())` and
 * `select using app.is_member(id)`; someone who defeats this redirect reaches
 * a page whose queries return their own events and whose writes are refused
 * by Postgres. What the redirect buys is honesty — an event_team member left
 * on this screen would see a create form that always fails.
 *
 * These routes are NOT event-scoped. Everything under `/{eventCode}` resolves
 * its event from the URL; this group sits above that and lists all of them.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const viewer = await getViewer()

  // No `?next=` here: a server layout cannot see the pathname, and sniffing
  // `headers()` to fake it opts the whole subtree out of static rendering.
  // /login lands on the front door, which is one tap from here.
  if (!viewer) redirect('/login')

  // `isAdmin` is `global_role = 'admin' AND is_active` — both halves of
  // `app.is_admin()`, so the app and the database agree. Reading only
  // `global_role` would let a deactivated admin in here and then show them
  // "no events exist", because RLS on `events` calls `app.is_admin()`.
  if (!viewer.isAdmin) redirect('/')

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <StickyHeader
        title="Admin"
        subtitle={viewer.fullName ?? viewer.email ?? 'Signed in'}
        backHref="/"
        backLabel="Back to events"
        right={<SignOutButton compact />}
      />

      {/* px-safe and the content gutter are the same property, so they cannot
          share a box — same split as the event layout. There is no tab bar on
          this route, so the bottom inset lives on <main>. */}
      <main className="flex-1 px-safe pb-safe">
        <div className="mx-auto w-full max-w-[480px] px-4 pt-4 pb-8">{children}</div>
      </main>
    </div>
  )
}
