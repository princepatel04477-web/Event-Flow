'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import type { StaffDepartment } from '@/lib/departments'
import {
  SECTIONS,
  childHref,
  childrenAreInBottomBar,
  resolveActive,
  visibleChildren,
  type TabAccess,
} from '@/lib/sections/config'
import { useBoundedPrefetch } from '@/lib/query/prefetch'
import { cn } from '@/lib/utils'

interface SectionTabsProps {
  eventCode: string
  access: TabAccess
  department?: StaffDepartment | null
}

/**
 * The second level of navigation.
 *
 * `SECTIONS[x].children` has always described a set of screens per section,
 * and for a long time the only consumer was the bottom bar picking `isDefault`
 * to decide where a tab lands. Nothing rendered the rest, which made every
 * non-default child unreachable: nine built, deployed, working screens with no
 * way in.
 *
 * Renders nothing in two cases. A section with fewer than two reachable
 * children gets no strip rather than a strip with one useless tab in it. And a
 * runner — whose bottom bar IS their section's children — gets no strip
 * either, because it would be the same four links twice on one screen.
 */
export function SectionTabs({ eventCode, access, department = null }: SectionTabsProps) {
  const pathname = usePathname()
  const rest = pathname.split('/').filter(Boolean).slice(1).join('/')

  // Above the early returns, because hooks are. Armed on touch rather than
  // eagerly like the bottom bar: a section can carry four children (Travel
  // does), and four full route renders per section entry is a fan-out where
  // the bottom bar's five are a one-off. The gap between the finger landing
  // and the tap completing is free latency; this spends it.
  const { isArmed, arm } = useBoundedPrefetch()

  // The runner's screens are already the bottom bar.
  if (childrenAreInBottomBar(access, department)) return null

  const active = resolveActive(rest)
  const section = active.sectionId ? SECTIONS[active.sectionId] : undefined
  if (!section) return null

  const visible = visibleChildren(section, access, department)
  if (visible.length < 2) return null

  // On a section root (`/EVENT/rsvp`) the default child is what actually
  // renders, so it is what should look selected. On a detail route
  // (`/EVENT/rsvp/status/<id>`) the child segment is still there, so drilling
  // into a record keeps its tab lit rather than clearing the whole strip.
  const currentChild = active.childSegment ?? visible.find((c) => c.isDefault)?.segment

  return (
    <nav
      aria-label={`${section.label} screens`}
      // `min-w-0` is load-bearing: without it the strip's min-content width
      // (every tab, nowrap) becomes the column's width and drags the whole
      // page past the right edge. Same failure as the arrivals chip row.
      className="-mx-4 mb-1 flex min-w-0 gap-1 overflow-x-auto overscroll-x-contain px-4 pb-px [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
    >
      {visible.map((child) => {
        const isActive = currentChild === child.segment
        const href = childHref(eventCode, section.id, child)
        return (
          <Link
            key={child.segment}
            href={href}
            // `undefined` is Next's default (viewport, partial — stops at the
            // nearest loading.tsx). `true` is the full route and its data, and
            // is only reached once a thumb is actually on this tab. Every
            // destination in SECTIONS.children reads only; the one write on
            // render anywhere in the nav is `rsvp/campaigns`, and it is
            // idempotent. Re-check that before adding a child here.
            prefetch={isArmed(href) ? true : undefined}
            onPointerDown={() => arm(href)}
            onTouchStart={() => arm(href)}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              // min-h-11 keeps the 44px tap target the rest of the app holds
              // to — this sits under a sticky header and gets hit with a
              // thumb, not a mouse.
              'tap relative shrink-0 whitespace-nowrap rounded-lg px-3 min-h-11 flex items-center',
              'text-sm font-medium transition-colors duration-press ease-ledger',
              isActive
                ? 'text-brand'
                : 'text-muted active:bg-surface-2 active:text-ink',
            )}
          >
            {child.label}
            {isActive ? (
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
