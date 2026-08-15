'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

import { cn } from '@/lib/utils'
import {
  GridIcon,
  LockIcon,
  FileTextIcon,
  ListIcon,
  SearchIcon,
  SlidersIcon,
} from '@/components/icons'
import { BottomSheet } from '@/components/ui/BottomSheet'

/**
 * Mobile bottom nav for admin screens. Three-tab bar + More sheet.
 * Fixed to the bottom with safe-area inset. Visible on md- only —
 * desktop gets the sidebar.
 */
export function AdminMobileNav() {
  const pathname = usePathname()
  const [moreOpen, setMoreOpen] = useState(false)

  const segments = pathname.split('/').filter(Boolean)
  // segments = ['admin', section, eventCode?, child?]
  const inEvents = segments[1] === 'events'
  const eventCode = inEvents ? segments[2] : undefined
  const child = eventCode ? segments[3] : undefined

  /**
   * Exactly one tab is active, always.
   *
   * The previous version tested each tab independently, and the tests
   * overlapped: on /admin/events/{code}/messages, Events matched
   * (segments[1] === 'events'), Dashboard matched (segments.length >= 3)
   * and Msgs matched (segments[3] === 'messages') — so three of the four
   * tabs rendered their active bar and dot at once and the bar stopped
   * telling you where you were. Deriving one value from the path makes
   * overlap unrepresentable rather than merely unlikely.
   *
   * Anything that is not the events list, an event root, or an event's
   * messages screen lives behind More (codes, ledger, staff, hotels,
   * harvest-debug), so More owns the fallback.
   */
  const tab: 'events' | 'dashboard' | 'msgs' | 'more' = !inEvents
    ? 'more'
    : !eventCode
      ? 'events'
      : !child
        ? 'dashboard'
        : child === 'messages'
          ? 'msgs'
          : 'more'

  const eventHref = eventCode ? `/admin/events/${eventCode}` : '/admin/events'

  return (
    <>
      <nav
        aria-label="Admin navigation"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-rule-strong bg-nav pb-safe px-safe md:hidden"
      >
        <ul className="mx-auto grid w-full max-w-[480px] grid-cols-4">
          <TabLink
            href="/admin/events"
            label="Events"
            icon={<GridIcon className="h-6 w-6" />}
            active={tab === 'events'}
          />
          <TabLink
            href={eventHref}
            label="Dashboard"
            icon={<SlidersIcon className="h-6 w-6" />}
            active={tab === 'dashboard'}
          />
          <TabLink
            href={eventCode ? `${eventHref}/messages` : '/admin/events'}
            label="Msgs"
            icon={<FileTextIcon className="h-6 w-6" />}
            active={tab === 'msgs'}
          />

          <li className="relative">
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-expanded={moreOpen}
              aria-haspopup="dialog"
              className={cn(
                'tap relative flex min-h-16 w-full flex-col items-center justify-center gap-1.5 px-0.5 py-2',
                'font-mono text-[0.625rem] leading-none font-medium tracking-[0.08em] uppercase',
                'transition-colors duration-press ease-ledger',
                tab === 'more' ? 'text-brand' : 'text-muted active:text-ink',
              )}
            >
              {tab === 'more' ? (
                <span aria-hidden className="absolute top-0 left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-b-sm bg-brand" />
              ) : null}
              <ListIcon className="h-6 w-6" aria-hidden />
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
        {/* The icon was accepted as a prop and never rendered — the 1.5px dot
            that used to sit here was a placeholder standing in for it, so the
            bar showed four unlabelled dots and every icon passed in was built
            and discarded. */}
        <span aria-hidden className="shrink-0">{icon}</span>
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
