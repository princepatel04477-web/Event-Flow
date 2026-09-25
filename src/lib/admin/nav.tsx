import type { ReactNode } from 'react'

import {
  GridIcon,
  BuildingIcon,
  LockIcon,
  FileTextIcon,
  ListIcon,
  SlidersIcon,
} from '@/components/icons'

/**
 * The admin nav, in ONE place.
 *
 * WHY THIS MODULE EXISTS. The desktop sidebar and the phone's "More" sheet each
 * carried their own hardcoded list, and they drifted: the sidebar gained
 * Hotels, Files and Settings, while the phone sheet still listed only Access
 * codes, Ledger and Messages — so three admin pages were reachable on a laptop
 * and unreachable on the handset the crew actually carries. Deriving both from
 * this list makes that class of drift unrepresentable.
 *
 * `href` is the path segment under `/admin` (sidebar) or under
 * `/admin/events/<code>` (event pages); `''` is the event root.
 */

export interface AdminNavItem {
  href: string
  label: string
  icon: ReactNode
  /** Matched against the pathname to highlight the active item. */
  matchSegments: string[]
}

/** Global (non-event) admin destinations. */
export const ADMIN_NAV: AdminNavItem[] = [
  {
    href: '/admin/events',
    label: 'Events',
    icon: <GridIcon className="h-5 w-5" />,
    matchSegments: ['events'],
  },
]

/**
 * Per-event pages. Every item here MUST also be reachable from the phone's More
 * sheet (see AdminMobileNav) — the shared import is what guarantees it.
 */
export const EVENT_NAV: AdminNavItem[] = [
  {
    href: '',
    label: 'Dashboard',
    icon: <GridIcon className="h-5 w-5" />,
    matchSegments: ['dashboard'],
  },
  {
    href: 'hotels',
    label: 'Hotels',
    icon: <BuildingIcon className="h-5 w-5" />,
    matchSegments: ['hotels'],
  },
  {
    href: 'codes',
    label: 'Access codes',
    icon: <LockIcon className="h-5 w-5" />,
    matchSegments: ['codes'],
  },
  {
    href: 'messages',
    label: 'Messages',
    icon: <FileTextIcon className="h-5 w-5" />,
    matchSegments: ['messages'],
  },
  {
    href: 'ledger',
    label: 'Ledger',
    icon: <ListIcon className="h-5 w-5" />,
    matchSegments: ['ledger'],
  },
  {
    href: 'files',
    label: 'Files',
    icon: <FileTextIcon className="h-5 w-5" />,
    matchSegments: ['files'],
  },
  {
    href: 'settings',
    label: 'Settings',
    icon: <SlidersIcon className="h-5 w-5" />,
    matchSegments: ['settings'],
  },
]
