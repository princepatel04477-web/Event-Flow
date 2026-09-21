'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type ReactNode } from 'react'

import { sectionAllowedForDepartment, type StaffDepartment } from '@/lib/departments'
import { cn } from '@/lib/utils'
import { SECTIONS, type SectionId, type TabAccess } from '@/lib/sections/config'

export type { TabAccess }
export { SECTIONS }

export interface BottomTabsProps {
  eventCode: string
  access: TabAccess
  /** Field team department from JWT; null = dashboard only until name is picked. */
  department?: StaffDepartment | null
}

/**
 * Section bottom bar — icon + short label per section. Equal-width flex
 * tabs, evenly distributed. Active state matches the current section by
 * path segment. Feature-flagged sections are hidden without a placeholder.
 *
 * Icons are from the section config — one source of truth shared with the
 * sidebar, breadcrumbs, and section headers.
 */
export function BottomTabs({ eventCode, access, department = null }: BottomTabsProps) {
  const pathname = usePathname()
  const segments = pathname.split('/').filter(Boolean)
  // segments = [eventCode, section, ...children]
  const currentSection = segments.length >= 2 ? segments[1] : ''

  const roleOk = (s: (typeof SECTIONS)[SectionId]) =>
    (access === 'admin' && s.roles.includes('admin'))
    || (access === 'event_team' && s.roles.includes('event_team'))
    || (access === 'client' && s.roles.includes('client'))

  const deptOk = (s: (typeof SECTIONS)[SectionId]) => {
    if (access === 'admin') return true
    if (access === 'client') return true
    if (!department) return s.id === 'dashboard'
    if (department === 'management') return true
    return s.departments.includes(department)
  }

  const visibleSections = Object.values(SECTIONS).filter(
    (s) => s.featureFlag === undefined && roleOk(s) && deptOk(s),
  )

  if (visibleSections.length === 0) return null

  return (
    <nav
      aria-label="Event sections"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-rule-strong bg-nav pb-safe px-safe"
    >
      <ul className="mx-auto grid w-full max-w-[480px]" style={{ gridTemplateColumns: `repeat(${visibleSections.length}, minmax(0, 1fr))` }}>
        {visibleSections.map((section) => {
          const defaultChild = section.children.find((c) => c.isDefault)
          const href = defaultChild
            ? `/${eventCode}/${section.id}/${defaultChild.segment}`
            : `/${eventCode}/${section.id}`
          const active = currentSection === section.id

          return (
            <li key={section.id} className="relative">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'tap relative flex min-h-14 flex-col items-center justify-center gap-0.5 px-0.5 py-2',
                  'text-[0.6875rem] leading-tight font-medium',
                  'transition-colors duration-press ease-ledger',
                  active ? 'text-brand' : 'text-muted active:text-ink',
                )}
              >
                {active ? (
                  <span
                    aria-hidden
                    className="absolute top-0 left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-b-sm bg-brand"
                  />
                ) : null}
                <span className={cn(
                  'text-brand',
                  active ? 'text-brand' : 'text-muted'
                )}>
                  {section.icon}
                </span>
                {/* `truncate` and `max-w-full` are load-bearing: a long tab
                    label ("Hospitality") would otherwise set the flex item's
                    min-content width and push the five-tab bar wider than the
                    screen. */}
                <span className="max-w-full truncate">{section.tabLabel}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export default BottomTabs
