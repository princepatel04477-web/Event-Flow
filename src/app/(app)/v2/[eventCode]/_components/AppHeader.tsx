'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { SignOutButton } from '@/components/auth/SignOutButton'
import { AdminLink } from '@/components/nav/AdminLink'
import { EventSwitcher } from '@/components/nav/EventSwitcher'
import { SearchIcon } from '@/components/icons'
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
 * - A search button on every screen pointing at /(app)/{event}/find (destination
 *   lands in V8).
 * - No welcome banner in the shell.
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
            className="tap flex h-11 w-11 items-center justify-center rounded-xl text-muted transition-colors duration-press ease-ledger hover:bg-surface-2 active:bg-surface-2"
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
