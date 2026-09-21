'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { SignOutButton } from '@/components/auth/SignOutButton'
import { SearchIcon } from '@/components/icons'
import { AdminLink } from '@/components/nav/AdminLink'
import { EventSwitcher } from '@/components/nav/EventSwitcher'
import { StickyHeader } from '@/components/ui/StickyHeader'
import { SECTIONS, resolveActive } from '@/lib/sections/config'
import type { Membership } from '@/lib/supabase/queries'

interface AppHeaderProps {
  event: {
    name: string
    code: string
  }
  viewer: {
    userId: string
    email: string | null
    fullName: string | null
    isAdmin: boolean
    memberships: Membership[]
  }
}

/**
 * Top bar for the (app) shell.
 *
 * Differences from the v1 shell:
 * - Header carries the screen's plain name and its back control, NOT the event
 *   name. A runner three screens deep needs to know where they are, not which
 *   wedding it is (the wedding name lives on the home screen).
 * - No welcome banner in the shell.
 *
 * There was a search button here pointing at `/{event}/find`. It was removed in
 * V7b, not because find was cancelled but because the route does not exist in
 * EITHER group — `(staff)/[eventCode]/find` was never built and no v2 shim can
 * cover a page that does not exist. Under v2 a missing route is a 404 and there
 * is no fallback (see AMENDMENTS §3), so every screen in the new UI carried a
 * permanent 404 in its header, and it would have been the single most-tapped
 * dead control in the app. A link to a 404 is worse than an absent link, so the
 * control is gone until V8 builds the destination. Restore the button WITH the
 * route, not before it.
 *
 * V8 built it, so the button is back. Same 44x44 target and same
 * `aria-label="Search"` it had, and the href is BARE — `/{event}/find`, no
 * `/v2`, no route group (AMENDMENTS §2): the internal prefix is the server's
 * business and a link carrying it 404s. It sits FIRST in the row because it is
 * the only control here about this event's people; the three to its right are
 * about the session. A client gets it too, and that is deliberate — `/find`
 * serves them their own list (see `find/page.tsx`), so it is not a staff door
 * in the header of a client's screen.
 */
export function AppHeader({ event, viewer }: AppHeaderProps) {
  const pathname = usePathname()

  // Strip leading slash, route groups (app)/(staff), and event code
  const segments = pathname.split('/').filter(Boolean).filter((s) => s !== '(app)' && s !== '(staff)')
  const rest = segments.slice(1).join('/')
  const isHome = rest === ''

  let screenTitle = 'Home'
  if (!isHome) {
    const active = resolveActive(rest)
    if (active.sectionId) {
      const section = SECTIONS[active.sectionId]
      if (active.childSegment) {
        const child = section.children.find((c) => c.segment === active.childSegment)
        screenTitle = child?.label ?? section.label
      } else {
        screenTitle = section.label
      }
    }
  }

  const backHref = isHome ? undefined : `/${event.code}`
  const backLabel = 'Home'

  return (
    <StickyHeader
      title={screenTitle}
      backHref={backHref}
      backLabel={backLabel}
      right={
        <nav className="flex items-center gap-1.5" aria-label="Header actions">
          <Link
            href={`/${event.code}/find`}
            aria-label="Search"
            className="tap -ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted transition-colors duration-press ease-ledger hover:bg-surface-2 active:bg-surface-2"
          >
            <SearchIcon className="h-5 w-5" />
          </Link>
          {viewer.memberships.length > 1 ? (
            <EventSwitcher
              events={viewer.memberships}
              currentCode={event.code}
              isAdmin={viewer.isAdmin}
            />
          ) : null}
          <AdminLink show={viewer.isAdmin} />
          <span className="ml-0.5 border-l border-rule-strong pl-2.5">
            <SignOutButton compact />
          </span>
        </nav>
      }
    />
  )
}

export default AppHeader
