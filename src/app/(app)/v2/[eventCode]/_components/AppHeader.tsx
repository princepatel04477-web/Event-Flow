'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { SignOutButton } from '@/components/auth/SignOutButton'
import { AccountMenu } from '@/components/nav/AccountMenu'
import { EventPill } from '@/components/nav/EventPill'
import { ScreenHeader, splitEventPath } from '@/components/ui/ScreenHeader'
import { formatDateRange } from '@/lib/utils'
import { v3ScreenTitle } from '@/lib/sections/v3'
import type { Membership } from '@/lib/supabase/queries'

interface AppHeaderProps {
  event: {
    name: string
    code: string
    startsOn?: string | null
    endsOn?: string | null
    venueCity?: string | null
  }
  viewer: {
    userId: string
    email: string | null
    fullName: string | null
    isAdmin: boolean
    memberships: Membership[]
  }
  /**
   * Rendered for every staff viewer. Help also has a small link at the foot of
   * Today, but Today is not a screen a department runner ever sees — the v2 home
   * redirects them to their own section — so the cheat sheet that carries
   * CLAUDE.md §11b's "do not reload" line was unreachable for exactly the people
   * it is written for. One row here is the reachable copy (`docs/BUGS.md` M35).
   */
  showHelp: boolean
  /**
   * Whether this viewer may open the guests section.
   *
   * The guests screens (list, import, export) are NOT in the v3 bottom bar —
   * Find replaced the tab — and the only other door was Today's empty-state card,
   * which renders only while the event has no guests. So on a live event the
   * Excel export job could not be started at all; inside the APK there is no URL
   * bar to type it into (`docs/BUGS.md` M33). This row is the door, and the
   * guests section layout renders the list | import | export strip once it is
   * open.
   */
  showGuests: boolean
}

/**
 * Top bar for the (app) shell — a thin wrapper that computes this screen's
 * title and hands it to `ScreenHeader`.
 *
 * WHY THE TITLE IS COMPUTED HERE AND NOT IN ScreenHeader. The header has to
 * know which screen it is on to name it, and that is ambient routing state.
 * Keeping `usePathname` in THIS component means `ScreenHeader` itself is
 * pure — a screen that wants the header look with a title of its own can
 * render `ScreenHeader` directly, with no pathname in the way. It is also
 * what let the id-map that named every screen ("deliveries" → "Hampers")
 * move out of here and into `src/lib/sections/v3.ts`, where it is a pure
 * function with a test.
 *
 * WHAT LEFT THE HEADER IN v3:
 * - the mono uppercase eyebrow over the title (the v3 look has no tracked
 *   capitals), replaced by `ScreenHeader`'s small muted context line.
 * - the Help glyph. Help is reached from a small link inside Today now, so
 *   it is not a permanent control on every screen.
 * - the admin link and the sign-out control, which are about the SESSION, not
 *   about this screen; at 360px they left the title about 90px wide. Sign-out
 *   lives in `AccountMenu` behind one 44px button; the admin's tools are the
 *   Control tab (UI4).
 *
 * WHAT CAME BACK IN UI4: the event itself, as a pill above the title
 * (`EventPill`). Knowing which wedding you are editing is not a session
 * detail — it is the most dangerous thing to get wrong — so it is on every
 * screen, and the switcher is one tap on it.
 *
 * WHAT STAYED: the search button, which is now the ONLY way into Find — and
 * therefore the only way to reach Guests, which is no longer a tab.
 */
export function AppHeader({ event, viewer, showHelp, showGuests }: AppHeaderProps) {
  const pathname = usePathname()
  const { rest } = splitEventPath(pathname)

  const title = v3ScreenTitle(rest)

  // The context line: the event's dates, or its city, or its code. Never the
  // event's NAME — the name is the one thing a runner three screens deep
  // does not need (they know which wedding they are at) and the one thing
  // that was truncating every title in v2.
  const context =
    formatDateRange(event.startsOn ?? null, event.endsOn ?? null) ??
    event.venueCity ??
    event.code

  return (
    <ScreenHeader
      title={title}
      context={context}
      eyebrow={
        <EventPill
          event={{ code: event.code, name: event.name }}
          memberships={viewer.memberships}
          isAdmin={viewer.isAdmin}
        />
      }
      actions={
        <AccountMenu>
          {/* The event switcher and the Admin link left this menu (UI4 Part
              S): the event is the pill above the title, and an admin's tools
              are the Control tab. */}
          {/* The two secondary jobs that have no home in the v3 bar:
              the guest list with its import/export screens, and Help. Both are
              about the SESSION rather than this screen, which is what this menu
              is for. */}
          {showGuests ? (
            <Link
              href={`/${event.code}/guests`}
              className="tap flex min-h-11 items-center rounded-xl px-1 text-sm font-medium text-ink hover:bg-surface-2 active:bg-surface-2"
            >
              Guest list · import · export
            </Link>
          ) : null}

          {showHelp ? (
            <Link
              href={`/${event.code}/help`}
              className="tap flex min-h-11 items-center rounded-xl px-1 text-sm font-medium text-ink hover:bg-surface-2 active:bg-surface-2"
            >
              How to use
            </Link>
          ) : null}

          <div className="mt-1 flex min-h-11 items-center border-t border-rule pt-2">
            <SignOutButton />
          </div>
        </AccountMenu>
      }
    />
  )
}

export default AppHeader
