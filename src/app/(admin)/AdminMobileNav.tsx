'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

import { cn } from '@/lib/utils'
import { type Membership } from '@/lib/events/paths'
import {
  GridIcon,
  LockIcon,
  FileTextIcon,
  ListIcon,
  SearchIcon,
  SlidersIcon,
} from '@/components/icons'
import { EventSwitcher } from '@/components/nav/EventSwitcher'
import { BottomSheet } from '@/components/ui/BottomSheet'

export interface AdminMobileNavProps {
  /** Every event this admin belongs to, for the switcher in the More sheet. */
  memberships: Membership[]
  /** Admin-ness is global, not per-event. */
  isAdmin: boolean
}

/**
 * Mobile bottom nav for admin screens. Three-tab bar + More sheet.
 * Fixed to the bottom with safe-area inset. Visible on md- only —
 * desktop gets the sidebar.
 */
export function AdminMobileNav({ memberships, isAdmin }: AdminMobileNavProps) {
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
                'text-[0.6875rem] leading-none font-medium',
                'transition-colors duration-press ease-ledger',
                tab === 'more' ? 'text-brand' : 'text-muted active:text-ink',
              )}
            >
              {/* v3 tab idiom: the active item is a maroon glyph in a tint
                  pill, not a rule drawn across the top edge. Same treatment
                  as the staff tab bar, so the two shells read alike. */}
              <span
                className={cn(
                  'flex h-7 items-center rounded-full px-4 transition-colors duration-press ease-ledger',
                  tab === 'more' && 'bg-brand-tint',
                )}
              >
                <ListIcon className="h-6 w-6" aria-hidden />
              </span>
              <span>More</span>
            </button>
          </li>
        </ul>
      </nav>

      <BottomSheet open={moreOpen} onClose={() => setMoreOpen(false)} label="More admin pages">
        <div className="flex flex-col gap-1 px-2">
          {/* The event switcher, which was the one control the admin layout's
              own comment promised everywhere and the phone did not have: the
              sidebar is `hidden md:flex`, and this sheet had no event control
              at all (`docs/BUGS.md` m11). Editing the wrong wedding is the
              most dangerous mistake on this panel, so the phone gets the same
              control the desktop has. */}
          {eventCode ? (
            <div className="flex min-h-11 items-center justify-between gap-2 rounded-xl px-3">
              <span className="text-sm font-medium text-muted">Switch event</span>
              <EventSwitcher
                events={memberships}
                currentCode={eventCode}
                isAdmin={isAdmin}
              />
            </div>
          ) : null}

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
          'text-[0.6875rem] leading-none font-medium',
          'transition-colors duration-press ease-ledger',
          active ? 'text-brand' : 'text-muted active:text-ink',
        )}
      >
        <span
          className={cn(
            'flex h-7 items-center rounded-full px-4 transition-colors duration-press ease-ledger',
            active && 'bg-brand-tint',
          )}
        >
          {/* The icon was accepted as a prop and never rendered — the 1.5px dot
              that used to sit here was a placeholder standing in for it, so the
              bar showed four unlabelled dots and every icon passed in was built
              and discarded. */}
          <span aria-hidden className="shrink-0">{icon}</span>
        </span>
        <span>{label}</span>
      </Link>
    </li>
  )
}

function SheetLink({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="tap flex min-h-11 items-center gap-3 rounded-xl px-3 text-base font-medium text-ink hover:bg-surface-2 active:bg-surface-2"
    >
      <span className="shrink-0 text-muted">{icon}</span>
      <span className="min-w-0 truncate">{label}</span>
    </Link>
  )
}

export default AdminMobileNav
