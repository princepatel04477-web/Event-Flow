'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'

import { cn } from '@/lib/utils'
import {
  GridIcon,
  LockIcon,
  FileTextIcon,
  ListIcon,
  SearchIcon,
} from '@/components/icons'
import { BottomSheet } from '@/components/ui/BottomSheet'

interface NavTab {
  segment: string
  label: string
  icon: React.ReactNode
}

const TABS: NavTab[] = [
  { segment: 'events', label: 'Events', icon: <GridIcon className="h-6 w-6" /> },
  { segment: 'events', label: 'Event', icon: <LockIcon className="h-6 w-6" /> },
  { segment: 'harvest-debug', label: 'Debug', icon: <SearchIcon className="h-6 w-6" /> },
]

/**
 * Mobile bottom nav for admin screens. Three-tab bar + More sheet.
 * Fixed to the bottom with safe-area inset. Visible on md- only —
 * desktop gets the sidebar.
 */
export function AdminMobileNav() {
  const pathname = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)

  const segments = pathname.split('/').filter(Boolean)
  const current = segments.length > 1 ? segments[1] : ''

  return (
    <>
      <nav
        aria-label="Admin navigation"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-rule-strong bg-nav pb-safe px-safe md:hidden"
      >
        <ul className="mx-auto grid w-full max-w-[480px] grid-cols-4">
          <TabLink href="/admin/events" label="Events" icon={<GridIcon className="h-6 w-6" />} active={segments[1] === 'events'} />
          <TabLink
            href={
              segments[1] === 'events' && segments[2]
                ? `/admin/events/${segments[2]}`
                : '/admin/events'
            }
            label="Dashboard"
            icon={<LockIcon className="h-6 w-6" />}
            active={segments.length >= 3 && segments[1] === 'events'}
          />
          <TabLink
            href={
              segments[1] === 'events' && segments[2]
                ? `/admin/events/${segments[2]}/messages`
                : '/admin/events'
            }
            label="Msgs"
            icon={<FileTextIcon className="h-6 w-6" />}
            active={segments[3] === 'messages'}
          />

          <li>
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-expanded={moreOpen}
              aria-haspopup="dialog"
              className={cn(
                'tap flex min-h-16 w-full flex-col items-center justify-center gap-1.5 px-0.5 py-2',
                'font-mono text-[0.625rem] leading-none font-medium tracking-[0.08em] uppercase',
                'transition-colors duration-press ease-ledger',
                'text-muted active:text-ink',
              )}
            >
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-transparent" />
              <span>More</span>
            </button>
          </li>
        </ul>
      </nav>

      <BottomSheet open={moreOpen} onClose={() => setMoreOpen(false)} label="More admin pages">
        <div className="flex flex-col gap-1 px-2">
          {segments[1] === 'events' && segments[2] ? (
            <>
              <SheetLink href={`/admin/events/${segments[2]}/codes`} label="Access codes" icon={<LockIcon className="h-5 w-5" />} />
              <SheetLink href={`/admin/events/${segments[2]}/ledger`} label="Ledger" icon={<ListIcon className="h-5 w-5" />} />
              <SheetLink href={`/admin/events/${segments[2]}/messages`} label="Messages" icon={<FileTextIcon className="h-5 w-5" />} />
            </>
          ) : (
            <>
              <SheetLink href="/admin/events" label="Events" icon={<GridIcon className="h-5 w-5" />} />
            </>
          )}
          <SheetLink href="/admin/harvest-debug" label="Harvest debug" icon={<SearchIcon className="h-5 w-5" />} />
        </div>
      </BottomSheet>
    </>
  )
}

function TabLink({ href, label, icon, active }: { href: string; label: string; icon: React.ReactNode; active: boolean }) {
  return (
    <li className="relative">
      <Link
        href={href}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'tap relative flex min-h-16 flex-col items-center justify-center gap-1.5 px-0.5 py-2',
          'font-mono text-[0.625rem] leading-none font-medium tracking-[0.08em] uppercase',
          'transition-colors duration-press ease-ledger',
          active ? 'text-brand' : 'text-muted active:text-ink',
        )}
      >
        {active ? (
          <span aria-hidden className="absolute top-0 left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-b-sm bg-brand" />
        ) : null}
        <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', active ? 'bg-brand' : 'bg-transparent')} />
        <span>{label}</span>
      </Link>
    </li>
  )
}

function SheetLink({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="tap flex items-center gap-3 rounded-xl px-3 py-3 text-base font-medium text-fg hover:bg-surface-2 active:bg-surface-2"
    >
      <span className="shrink-0 text-muted">{icon}</span>
      <span>{label}</span>
    </Link>
  )
}

export default AdminMobileNav
