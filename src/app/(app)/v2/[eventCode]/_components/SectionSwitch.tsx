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

interface SectionSwitchProps {
  eventCode: string
  access: TabAccess
  department: StaffDepartment | null
}

/**
 * The screens inside the current tab, as one row of pills under the header.
 *
 * WHY THIS EXISTS (UI4 Part S). The v3 shell dropped the section strip to keep
 * one nav row, and nothing replaced it for an event lead: their bar is one tab
 * per SECTION, so Check in, Rooming list, Hampers, Departures, Fleet, Trips and
 * Call notes had no door except a button buried inside another screen — and
 * several had none at all. A runner never needed this (their bar already IS
 * their section's screens, `childrenAreInBottomBar`), so it renders for leads
 * and admins only, and only in a section with two or more screens.
 *
 * Guests keeps its own strip in `guests/layout.tsx`, so it is skipped here —
 * two strips on one screen is the failure this is meant to prevent.
 *
 * It is a plain horizontal list of links: no animation, no indicator that
 * slides (UI4 §3, F1/F5). The active pill is a tint fill, which changes on the
 * next paint and costs nothing.
 */
export function SectionSwitch({ eventCode, access, department }: SectionSwitchProps) {
  const pathname = usePathname()
  const rest = pathname.split('/').filter(Boolean).slice(1).join('/')
  const { isArmed, arm } = useBoundedPrefetch()

  if (childrenAreInBottomBar(access, department)) return null

  const active = resolveActive(rest)
  if (!active.sectionId || active.sectionId === 'guests') return null
  const section = SECTIONS[active.sectionId]

  const visible = visibleChildren(section, access, department)
  if (visible.length < 2) return null

  // The v2 hamper run lives at hospitality/deliveries as well as /hamper;
  // either address is the Hampers pill.
  const segment = active.childSegment === 'deliveries' ? 'hamper' : active.childSegment
  const current = segment ?? visible.find((c) => c.isDefault)?.segment

  return (
    <nav
      aria-label={`${section.tabLabel} screens`}
      className="-mx-4 mb-3 flex min-w-0 gap-2 overflow-x-auto overscroll-x-contain px-4 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {visible.map((child) => {
        const href = childHref(eventCode, section.id, child)
        const isActive = current === child.segment
        return (
          <Link
            key={child.segment}
            href={href}
            prefetch={isArmed(href) ? true : undefined}
            onPointerDown={() => arm(href)}
            onTouchStart={() => arm(href)}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'tap flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-full border px-4 text-sm font-medium',
              'transition-colors duration-press ease-ledger',
              isActive
                ? 'border-brand bg-brand text-brand-fg'
                : 'border-rule-strong bg-surface text-ink active:bg-surface-2',
            )}
          >
            {child.label}
          </Link>
        )
      })}
    </nav>
  )
}

export default SectionSwitch
