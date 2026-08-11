'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type ReactNode } from 'react'

import { cn } from '@/lib/utils'
import { SECTIONS, type SectionId, type TabAccess } from '@/lib/sections/config'

export type { TabAccess }
export { SECTIONS }

export interface BottomTabsProps {
  eventCode: string
  access: TabAccess
}

/**
 * Five-section bottom bar. Each section is a tab with its icon + label.
 * Active state highlights the current section by path segment. Sub-navigation
 * lives inside each section's own layout, never at the top level.
 *
 * Icons are from the section config — one source of truth shared with the
 * sidebar, breadcrumbs, and section headers.
 */
export function BottomTabs({ eventCode, access }: BottomTabsProps) {
  const pathname = usePathname()
  const segments = pathname.split('/').filter(Boolean)
  // segments = [eventCode, section, ...children]
  const currentSection = segments.length >= 2 ? segments[1] : ''

  // Five operational sections that staff and admin can reach
  const visibleSections = Object.values(SECTIONS).filter(
    (s) => (access === 'admin' && s.roles.includes('admin'))
        || (access === 'event_team' && s.roles.includes('event_team'))
        || (access === 'client' && s.roles.includes('client'))
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
                  'tap relative flex min-h-16 flex-col items-center justify-center gap-1 px-0.5 py-2',
                  'font-mono text-[0.625rem] leading-none font-medium tracking-[0.08em] uppercase',
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
                <span>{section.tabLabel}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export default BottomTabs
