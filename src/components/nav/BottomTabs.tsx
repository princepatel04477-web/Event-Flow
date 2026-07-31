'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'
import {
  ClipboardCheckIcon,
  GridIcon,
  PhoneIcon,
  UploadIcon,
} from '@/components/icons'

type Tab = {
  /** Path segment after /{eventCode}. Empty string is the dashboard. */
  segment: string
  label: string
  icon: ReactNode
}

/** The access strings this bar knows how to draw. */
export type TabAccess = 'admin' | 'event_team' | 'client'

const QUEUE: Tab = {
  segment: 'queue',
  label: 'Queue',
  icon: <PhoneIcon className="h-6 w-6" />,
}
const IMPORT: Tab = {
  segment: 'import',
  label: 'Import',
  icon: <UploadIcon className="h-6 w-6" />,
}
const REVIEW: Tab = {
  segment: 'review',
  label: 'Review',
  icon: <ClipboardCheckIcon className="h-6 w-6" />,
}
const DASHBOARD: Tab = {
  segment: '',
  label: 'Dashboard',
  icon: <GridIcon className="h-6 w-6" />,
}

/**
 * One list per role, built from the session — not three copies of the bar.
 *
 * `client` gets an empty list and therefore no bar at all: a client can reach
 * exactly one page in the event, and a lone tab pointing at the page you are
 * already standing on is decoration that costs 4.75rem of a 360px screen.
 */
const TABS_BY_ACCESS: Record<TabAccess, Tab[]> = {
  admin: [QUEUE, IMPORT, REVIEW, DASHBOARD],
  // Import is admin-only by product decision, so event_team gets three.
  event_team: [QUEUE, REVIEW, DASHBOARD],
  client: [],
}

/**
 * Tailwind scans source for literal class names, so the column count has to
 * be spelled out rather than interpolated. Keeps the grid honest when the
 * list is three tabs instead of four.
 */
const GRID_COLS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
}

export interface BottomTabsProps {
  /** Canonical event code from the database, not the raw URL segment. */
  eventCode: string
  /**
   * The viewer's role on THIS event, resolved on the server by the layout.
   * Passed in rather than looked up here — this is a client component and
   * must never touch Supabase.
   */
  access: TabAccess
}

/**
 * Thumb-reach navigation. Fixed to the bottom because that is where a hand
 * already is when you are holding a phone and a clipboard.
 */
export function BottomTabs({ eventCode, access }: BottomTabsProps) {
  const pathname = usePathname()
  const tabs = TABS_BY_ACCESS[access] ?? []

  if (tabs.length === 0) return null

  // The event code in the URL may differ in case from the canonical one, so
  // match on position rather than on the full path.
  const segments = pathname.split('/').filter(Boolean)
  const current = segments.length > 1 ? segments[1] : ''

  return (
    <nav
      aria-label="Event sections"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface pb-safe px-safe"
    >
      <ul
        className={cn(
          'mx-auto grid w-full max-w-[480px]',
          GRID_COLS[tabs.length] ?? 'grid-cols-4',
        )}
      >
        {tabs.map((tab) => {
          const href = tab.segment ? `/${eventCode}/${tab.segment}` : `/${eventCode}`
          const active = current === tab.segment

          return (
            <li key={tab.label}>
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'tap flex min-h-16 flex-col items-center justify-center gap-1 px-1 py-2 text-xs font-medium',
                  active ? 'text-brand' : 'text-muted hover:text-fg',
                )}
              >
                {tab.icon}
                <span className="leading-none">{tab.label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export default BottomTabs
