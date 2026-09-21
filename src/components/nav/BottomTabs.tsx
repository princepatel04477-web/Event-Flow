'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { type StaffDepartment } from '@/lib/departments'
import { useBoundedPrefetch } from '@/lib/query/prefetch'
import { cn } from '@/lib/utils'
import { SECTIONS, bottomTabsFor, resolveActive, type TabAccess } from '@/lib/sections/config'

export type { TabAccess }
export { SECTIONS }

export interface BottomTabsProps {
  eventCode: string
  access: TabAccess
  /** Field team department from JWT; null = dashboard only until name is picked. */
  department?: StaffDepartment | null
}

/**
 * The bottom bar — icon + short label per tab, equal-width, evenly distributed.
 *
 * What goes IN the bar is decided by `bottomTabsFor` in the section config, not
 * here: an event lead gets the five sections, a runner gets their own section's
 * screens, and a runner with a single screen gets no bar at all. The layout
 * asks the same function whether to reserve space at the bottom, so the bar and
 * the page clearance can no longer disagree.
 */
export function BottomTabs({ eventCode, access, department = null }: BottomTabsProps) {
  const pathname = usePathname()
  // segments = [eventCode, ...rest]
  const rest = pathname.split('/').filter(Boolean).slice(1).join('/')

  // Above the early return below, because hooks are.
  const { isArmed, arm } = useBoundedPrefetch()

  const tabs = bottomTabsFor(eventCode, access, department)
  if (tabs.length === 0) return null

  const active = resolveActive(rest)

  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-0 z-40 border-t border-rule-strong bg-nav pb-safe px-safe transition-[bottom] duration-press ease-ledger"
      style={{ bottom: 'var(--keyboard-offset, 0px)' }}
    >
      <ul className="mx-auto grid w-full max-w-[480px]" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map((tab) => {
          // A section tab lights for anything inside its section; a runner's
          // child tab has to match the child too, since every tab they have is
          // in the same section.
          const isActive = tab.childSegment === null
            ? active.sectionId === tab.sectionId
            : active.sectionId === tab.sectionId && active.childSegment === tab.childSegment

          return (
            <li key={tab.key} className="relative">
              <Link
                href={tab.href}
                // FULL prefetch — the route AND its data — not Next's default.
                //
                // The default for a dynamic route is a PARTIAL prefetch that
                // stops at the nearest `loading.tsx`, and this app has 28 of
                // them. So without this the bar was warming skeletons: the tap
                // still crossed to Seoul, it just got a skeleton to look at
                // while it did. A skeleton arriving in 40ms does not make the
                // app fast, it makes the wait visible.
                //
                // ARMED ON TOUCH, NOT EAGERLY, AND THAT IS A MEASUREMENT
                // RESULT RATHER THAN A PREFERENCE. Prefetching all five on
                // mount is a bounded cost in requests and an unbounded one in
                // contention: on the venue-Wi-Fi profile (300ms / 1.5Mbps) five
                // full RSC renders land on the same pipe the screen the runner
                // is ON still needs. Measured at n=5, it made Home's frame far
                // faster and every other route SLOWER — the calling queue's
                // destination frame went 1280ms → 2556ms. Five prefetches is
                // not a fixed cost when the link is the scarce thing; it is a
                // fixed cost charged to the wrong request. Numbers in
                // DECISIONS.md, 21 September 2026.
                //
                // `undefined` is Next's default (viewport, partial — stops at
                // the nearest loading.tsx). `true` is the full route and its
                // data, and is reached only once a thumb is on this tab, which
                // spends the touchstart-to-tap gap instead of the runner's
                // bandwidth.
                //
                // All five destinations only read, which is what makes arming
                // them safe at all. The one exception is Calls →
                // `rsvp/campaigns`, whose `ensureCampaigns` inserts the default
                // draft waves if none exist — idempotent, and the same rows the
                // first real visit would create. Any tab added here needs that
                // check first: a full prefetch runs the destination's server
                // render for real. See src/lib/query/prefetch.ts.
                prefetch={isArmed(tab.href) ? true : undefined}
                onPointerDown={() => arm(tab.href)}
                onTouchStart={() => arm(tab.href)}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'tap relative flex min-h-14 flex-col items-center justify-center gap-0.5 px-0.5 py-2',
                  'text-xs leading-tight font-medium',
                  'transition-colors duration-press ease-ledger',
                  isActive ? 'text-brand' : 'text-muted active:text-ink',
                )}
              >
                {isActive ? (
                  <span
                    aria-hidden
                    className="absolute top-0 left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-b-sm bg-brand"
                  />
                ) : null}
                <span className={cn(isActive ? 'text-brand' : 'text-muted')}>
                  {tab.icon}
                </span>
                {/* `truncate` and `max-w-full` are load-bearing: a long tab
                    label ("Check in / out") would otherwise set the flex item's
                    min-content width and push the bar wider than the screen. */}
                <span className="max-w-full truncate">{tab.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export default BottomTabs
