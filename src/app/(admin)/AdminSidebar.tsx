'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

import { cn } from '@/lib/utils'
import { type Membership } from '@/lib/events/paths'
import {
  GridIcon,
  LockIcon,
  FileTextIcon,
  ListIcon,
  SearchIcon,
} from '@/components/icons'
import { SignOutButton } from '@/components/auth/SignOutButton'
import { EventSwitcher } from '@/components/nav/EventSwitcher'

type Viewer = {
  userId: string
  email: string | null
  fullName: string | null
  isAdmin: boolean
  memberships: Membership[]
}

interface NavItem {
  href: string
  label: string
  icon: React.ReactNode
  /** Matched against the pathname to highlight the active item. */
  matchSegments: string[]
}

const ADMIN_NAV: NavItem[] = [
  {
    href: '/admin/events',
    label: 'Events',
    icon: <GridIcon className="h-5 w-5" />,
    matchSegments: ['events'],
  },
]

const EVENT_NAV: NavItem[] = [
  {
    href: '',
    label: 'Dashboard',
    icon: <GridIcon className="h-5 w-5" />,
    matchSegments: ['dashboard'],
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
]

export function AdminSidebar({ viewer }: { viewer: Viewer }) {
  const pathname = usePathname()
  const segments = pathname.split('/').filter(Boolean)

  // Determine if we're on the events list or inside a specific event.
  const isOnEvents = segments[1] === 'events' && segments.length === 2
  const isInEvent = segments[1] === 'events' && segments.length >= 3
  const eventCode = isInEvent ? segments[2] : null
  const currentSeg = segments.length >= 4 ? segments[3] : ''

  // Build event-specific nav links with the active event code.
  const eventNavItems = eventCode
    ? EVENT_NAV.map((item) => ({
        ...item,
        href: `/admin/events/${eventCode}/${item.href}`.replace(/\/$/, ''),
      }))
    : []

  const activeEvent = viewer.memberships.find((m) => m.eventCode === eventCode)

  function isActive(item: NavItem): boolean {
    if (item.matchSegments.length === 1 && item.matchSegments[0] === 'events') {
      return segments[1] === 'events'
    }
    return item.matchSegments.some((s) => currentSeg === s)
  }

  return (
    <aside className="hidden w-56 shrink-0 border-r border-rule bg-surface-2 md:flex md:flex-col">
      {/* Event switcher at the top — always visible */}
      <div className="border-b border-rule px-3 py-3">
        <p className="mb-1 font-mono text-[0.625rem] font-bold uppercase tracking-[0.1em] text-subtle">
          Event
        </p>
        {isInEvent && activeEvent ? (
          <EventSwitcher
            events={viewer.memberships}
            currentCode={eventCode ?? ''}
            isAdmin={viewer.isAdmin}
          />
        ) : (
          <p className="text-sm font-medium text-fg">
            {isOnEvents ? 'Event list' : 'No event selected'}
          </p>
        )}
        {isInEvent && !activeEvent ? (
          <p className="mt-1 text-xs text-warning">Event not found in your memberships</p>
        ) : null}
      </div>

      {/* Event section */}
      {isInEvent && eventCode ? (
        <div className="flex flex-col gap-0.5 px-2 py-3">
          <p className="mb-1 px-2 font-mono text-[0.625rem] font-bold uppercase tracking-[0.1em] text-subtle">
            Event pages
          </p>
          {eventNavItems.map((item) => (
            <SidebarLink key={item.href} item={item} active={isActive(item)} />
          ))}
        </div>
      ) : null}

      {/* General section */}
      <div className="flex flex-col gap-0.5 px-2 py-3">
        <p className="mb-1 px-2 font-mono text-[0.625rem] font-bold uppercase tracking-[0.1em] text-subtle">
          General
        </p>
        {ADMIN_NAV.map((item) => (
          <SidebarLink key={item.href} item={item} active={isActive(item)} />
        ))}
        <SidebarLink
          item={{
            href: '/admin/harvest-debug',
            label: 'Harvest debug',
            icon: <SearchIcon className="h-5 w-5" />,
            matchSegments: ['harvest-debug'],
          }}
          active={segments[1] === 'harvest-debug'}
        />
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Identity + sign out at the bottom */}
      <div className="border-t border-rule px-3 py-3">
        <div className="mb-2">
          <p className="truncate text-sm font-medium text-fg">
            {viewer.fullName ?? viewer.email ?? 'Admin'}
          </p>
          <p className="truncate text-xs text-muted">{viewer.email ?? ''}</p>
        </div>
        <SignOutButton className="w-full" />
      </div>
    </aside>
  )
}

function SidebarLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      className={cn(
        'tap flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-brand/10 text-brand'
          : 'text-muted hover:bg-surface hover:text-fg',
      )}
    >
      {item.icon}
      <span>{item.label}</span>
      {active ? (
        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brand" aria-hidden />
      ) : null}
    </Link>
  )
}

export default AdminSidebar
