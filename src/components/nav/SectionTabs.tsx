'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { SECTIONS, type SectionId, type TabAccess } from '@/lib/sections/config'
import { cn } from '@/lib/utils'

interface SectionTabsProps {
  eventCode: string
  access: TabAccess
}

/**
 * The second level of navigation, which until now did not exist.
 *
 * `SECTIONS[x].children` has always described a set of screens per section,
 * and the only consumer was BottomTabs picking `isDefault` to decide where a
 * tab lands. Nothing rendered the rest. That made every non-default child
 * unreachable from the UI — nine built, deployed, working screens with no way
 * in: Check-in / out, Departures, Fleet, Trips, Review, Unmatched, Import,
 * Export, and RSVP status. Hampers were the tenth until they were promoted to
 * a section of their own, which is the workaround this component removes the
 * need for.
 *
 * Renders nothing when a section has fewer than two visible children, so
 * Dashboard and Hamper (no children) and a client's Guests (one permitted
 * child) get no strip rather than a strip with one useless tab in it.
 */
export function SectionTabs({ eventCode, access }: SectionTabsProps) {
  const pathname = usePathname()
  // segments = [eventCode, section, child, ...rest]
  const segments = pathname.split('/').filter(Boolean)
  const sectionId = segments[1] as SectionId | undefined
  const section = sectionId ? SECTIONS[sectionId] : undefined

  if (!section || section.featureFlag !== undefined) return null

  const visible = section.children.filter((c) => c.roles.includes(access))
  if (visible.length < 2) return null

  // On a section root (`/EVENT/rsvp`) the default child is what actually
  // renders, so it is what should look selected. On a detail route
  // (`/EVENT/rsvp/status/<id>`) segments[2] is still the child, so drilling
  // into a record keeps its tab lit rather than clearing the whole strip.
  const currentChild = segments[2] ?? visible.find((c) => c.isDefault)?.segment

  return (
    <nav
      aria-label={`${section.label} screens`}
      // `min-w-0` is load-bearing: without it the strip's min-content width
      // (every tab, nowrap) becomes the column's width and drags the whole
      // page past the right edge. Same failure as the arrivals chip row.
      className="-mx-4 mb-1 flex min-w-0 gap-1 overflow-x-auto px-4 pb-px"
    >
      {visible.map((child) => {
        const active = currentChild === child.segment
        return (
          <Link
            key={child.segment}
            href={`/${eventCode}/${section.id}/${child.segment}`}
            aria-current={active ? 'page' : undefined}
            className={cn(
              // min-h-11 keeps the 44px tap target the rest of the app holds
              // to — this sits under a sticky header and gets hit with a
              // thumb, not a mouse.
              'tap relative shrink-0 whitespace-nowrap rounded-lg px-3 min-h-11 flex items-center',
              'text-sm font-medium transition-colors duration-press ease-ledger',
              active
                ? 'text-brand'
                : 'text-muted active:bg-surface-2 active:text-ink',
            )}
          >
            {child.label}
            {active ? (
              <span
                aria-hidden
                className="absolute inset-x-3 bottom-0 h-0.5 rounded-t-sm bg-brand"
              />
            ) : null}
          </Link>
        )
      })}
    </nav>
  )
}

export default SectionTabs
