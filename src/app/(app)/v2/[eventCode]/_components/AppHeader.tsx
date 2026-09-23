'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { SVGProps } from 'react'

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
  /**
   * Whether the "?" cheat sheet belongs in this header.
   *
   * Passed in rather than derived here, because the answer is the SERVER's: the
   * shell has already resolved `getEventAccess`, and the help route runs
   * `requireStaff`, which bounces a client to their one screen. A client who
   * tapped a "?" this component rendered itself would be thrown off the page
   * they were reading — so the control is withheld for them here rather than
   * discovered to be a dead end by tapping it.
   */
  showHelp: boolean
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
/**
 * The "?" glyph.
 *
 * Local to the new group's header rather than added to `src/components/icons.tsx`,
 * which is shared with v1: this session may not grow the icon set the live app
 * depends on for a glyph only the new UI draws. Same 24px stroke geometry and
 * the same props contract as that module's icons, so swapping it for a shared
 * export later is a one-line change and not a redraw.
 */
/**
 * Titles for screens `resolveActive` cannot name from the shared nav config.
 *
 * `hospitality/deliveries` has no matching child in `SECTIONS.hospitality`
 * (its children are `rooms`, `checkin`, and the borrowed `hamper`/
 * `production`) — so without this map the header fell back to the SECTION's
 * own label, "Rooms", on the one screen in Rooms that isn't about rooms.
 * Keyed on `section/childSegment`, not the full `rest` path: the detail
 * route `hospitality/deliveries/{deliverableId}` resolves to the same
 * `sectionId`/`childSegment` pair (`resolveActive` only reads the first two
 * URL segments), and a `rest`-keyed map would miss it the moment an id
 * followed the child in the URL.
 */
const SECTION_CHILD_TITLE_OVERRIDES: Record<string, string> = {
  'hospitality/deliveries': 'Hampers',
}

/**
 * Titles for screens with no section at all — `resolveActive` answers
 * `sectionId: null` for these, same as `help`. Without an entry here the
 * title falls through to the 'Home' default: the back destination's name,
 * not the screen's.
 */
const NO_SECTION_TITLE_OVERRIDES: Record<string, string> = {
  find: 'Find',
}

function QuestionIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable={false}
      {...props}
    >
      <path d="M9.1 9a3 3 0 1 1 4.2 2.7c-.8.4-1.3 1.1-1.3 2v.3" />
      <path d="M12 17.5h.01" />
    </svg>
  )
}

export function AppHeader({ event, viewer, showHelp }: AppHeaderProps) {
  const pathname = usePathname()

  // Strip leading slash, route groups (app)/(staff), and event code
  const segments = pathname.split('/').filter(Boolean).filter((s) => s !== '(app)' && s !== '(staff)')
  const rest = segments.slice(1).join('/')
  const isHome = rest === ''

  let screenTitle = 'Home'
  let screenSubtitle: string | undefined
  if (!isHome) {
    const active = resolveActive(rest)
    if (active.sectionId) {
      const section = SECTIONS[active.sectionId]
      if (active.childSegment) {
        const child = section.children.find((c) => c.segment === active.childSegment)
        // Keyed on section/child, not the full `rest` path: a detail route
        // like `hospitality/deliveries/{deliverableId}` still resolves its
        // childSegment to `deliveries` (`resolveActive` only reads the first
        // two segments), and a `rest`-keyed lookup would miss it the moment
        // an id followed the child in the URL.
        const overrideKey = `${active.sectionId}/${active.childSegment}`
        screenTitle = child?.label ?? SECTION_CHILD_TITLE_OVERRIDES[overrideKey] ?? section.label
      } else {
        screenTitle = section.label
      }
    } else if (rest === 'help') {
      // The cheat sheet is a screen with no section — `resolveActive` answers
      // `sectionId: null` for it, so without this the header would title the
      // one screen that explains the app "Home", while the reader is
      // standing on it and Home is the link they came from.
      //
      // Split across title + subtitle rather than one long title: "How this
      // app works" alone in the title row, squeezed against search/help/
      // sign-out, truncated to "HOW THIS A…" — illegible on the one screen
      // whose entire job is to be read at a glance by someone who is lost.
      screenTitle = 'Help'
      screenSubtitle = 'How this app works'
    } else {
      screenTitle = NO_SECTION_TITLE_OVERRIDES[rest] ?? screenTitle
    }
  }

  const backHref = isHome ? undefined : `/${event.code}`
  const backLabel = 'Home'

  return (
    <StickyHeader
      title={screenTitle}
      subtitle={screenSubtitle}
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
          {showHelp ? (
            <Link
              href={`/${event.code}/help`}
              aria-label="Help"
              className="tap flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted transition-colors duration-press ease-ledger hover:bg-surface-2 active:bg-surface-2"
            >
              <QuestionIcon className="h-5 w-5" />
            </Link>
          ) : null}
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
