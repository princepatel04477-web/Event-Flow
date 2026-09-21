'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { type StaffDepartment } from '@/lib/departments'
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
