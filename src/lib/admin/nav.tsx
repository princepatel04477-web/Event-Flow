import type { ReactNode } from 'react'

import {
  GridIcon,
  BuildingIcon,
  CarIcon,
  GiftIcon,
  LockIcon,
  FileTextIcon,
  ListIcon,
  PhoneIcon,
  SlidersIcon,
  UploadIcon,
  UsersIcon,
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
    href: 'staff',
    label: 'Staff',
    icon: <UsersIcon className="h-5 w-5" />,
    matchSegments: ['staff'],
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

/**
 * The event's working screens, reachable from the admin panel.
 *
 * The admin panel used to be a dead end: nothing in it led to the screens the
 * crew actually works in (Today, Calls, Guests, Rooms, Hampers, Travel), so an
 * admin had to know the URLs. An admin passes every section guard
 * (`requireSection` lets `admin` through), so these are real doors, not
 * bounces. ABSOLUTE hrefs: they live outside `/admin`.
 */
export function eventAppNav(eventCode: string): AdminNavItem[] {
  const at = (path: string) => (path ? `/${eventCode}/${path}` : `/${eventCode}`)
  return [
    { href: at(''), label: 'Today', icon: <GridIcon className="h-5 w-5" />, matchSegments: [] },
    { href: at('rsvp/queue'), label: 'Calls', icon: <PhoneIcon className="h-5 w-5" />, matchSegments: [] },
    { href: at('guests'), label: 'Guest list', icon: <UsersIcon className="h-5 w-5" />, matchSegments: [] },
    { href: at('guests/import'), label: 'Import guests', icon: <UploadIcon className="h-5 w-5" />, matchSegments: [] },
    { href: at('hospitality/rooms'), label: 'Rooms', icon: <BuildingIcon className="h-5 w-5" />, matchSegments: [] },
    { href: at('hospitality/deliveries'), label: 'Hampers', icon: <GiftIcon className="h-5 w-5" />, matchSegments: [] },
    { href: at('logistics'), label: 'Logistics', icon: <CarIcon className="h-5 w-5" />, matchSegments: [] },
  ]
}
