'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, type ReactNode } from 'react'

import { cn } from '@/lib/utils'
import {
  ArrowDownCircleIcon,
  ArrowUpCircleIcon,
  BoxIcon,
  BuildingIcon,
  CarIcon,
  ClipboardCheckIcon,
  GridIcon,
  PhoneIcon,
  PlaneIcon,
  UploadIcon,
} from '@/components/icons'
import { MoreSheet, type MoreSheetItem } from './MoreSheet'

type Tab = {
  /** Path segment after /{eventCode}. Empty string is the dashboard. */
  segment: string
  /**
   * The bar label — one word, uppercased by CSS. "RUNS" not "Deliveries":
   * at six slots on a 360px screen the label has ~55px, and a word that
   * truncates is worse than a shorter word that does not.
   */
  label: string
  /** Longer label for the More sheet, which has a full row to spend. */
  sheetLabel?: string
  icon: ReactNode
}

/** The access strings this bar knows how to draw. */
export type TabAccess = 'admin' | 'event_team' | 'client'

const BOARD: Tab = {
  segment: '',
  label: 'Board',
  sheetLabel: 'Dashboard',
  icon: <GridIcon className="h-6 w-6" />,
}
const QUEUE: Tab = {
  segment: 'queue',
  label: 'Queue',
  icon: <PhoneIcon className="h-6 w-6" />,
}
const ROOMS: Tab = {
  segment: 'rooms',
  label: 'Rooms',
  icon: <BuildingIcon className="h-6 w-6" />,
}
const DELIVERIES: Tab = {
  segment: 'deliveries',
  label: 'Runs',
  sheetLabel: 'Deliveries',
  icon: <BoxIcon className="h-6 w-6" />,
}
const ARRIVALS: Tab = {
  segment: 'arrivals',
  label: 'Arrivals',
  icon: <ArrowDownCircleIcon className="h-6 w-6" />,
}
const FLEET: Tab = {
  segment: 'fleet',
  label: 'Fleet',
  icon: <CarIcon className="h-6 w-6" />,
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
const LOGISTICS: Tab = {
  segment: 'logistics',
  label: 'Trips',
  icon: <PlaneIcon className="h-6 w-6" />,
}
const DEPARTURES: Tab = {
  segment: 'departures',
  label: 'Departures',
  icon: <ArrowUpCircleIcon className="h-6 w-6" />,
}

/**
 * Five primary tabs plus a More sheet, in the six-slot bar the design
 * specifies.
 *
 * The bar is text-only — a mono label under a state dot, no glyphs. Six
 * icons on a 360px bar are 6 icons nobody can tell apart at arm's length
 * in a corridor, and every one of these sections is a *noun a caller
 * already says out loud* ("I'm on the queue", "put it on the board"). The
 * word is the icon. The sheet keeps its glyphs, because there a row has
 * space for both.
 *
 * Board leads because it is where a shift starts and where a caller
 * returns between families. Setup screens (import, fleet, trips) and the
 * screens that want a bigger read (review, departures) live one tap deeper.
 *
 * `client` gets no bar at all: a client can reach exactly one page in the
 * event, and a lone tab pointing at the page you are already standing on
 * is decoration that costs 4.75rem of a 360px screen.
 */
const PRIMARY_BY_ACCESS: Record<TabAccess, Tab[]> = {
  admin: [BOARD, QUEUE, ROOMS, DELIVERIES, ARRIVALS],
  event_team: [BOARD, QUEUE, ROOMS, DELIVERIES, ARRIVALS],
  client: [],
}

/**
 * The More sheet contents. Import is admin-only (see import/page.tsx), so
 * an `event_team` member is not offered a link that would bounce them off
 * `requireAdmin`.
 */
const MORE_BY_ACCESS: Record<TabAccess, Tab[]> = {
  admin: [IMPORT, REVIEW, FLEET, LOGISTICS, DEPARTURES],
  event_team: [REVIEW, FLEET, LOGISTICS, DEPARTURES],
  client: [],
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
  const [moreOpen, setMoreOpen] = useState(false)

  const primary = PRIMARY_BY_ACCESS[access] ?? []
  const more = MORE_BY_ACCESS[access] ?? []

  if (primary.length === 0) return null

  // The event code in the URL may differ in case from the canonical one, so
  // match on position rather than on the full path.
  const segments = pathname.split('/').filter(Boolean)
  const current = segments.length > 1 ? segments[1] : ''

  const moreItems: MoreSheetItem[] = more.map((t) => ({
    segment: t.segment,
    label: t.sheetLabel ?? t.label,
    icon: t.icon,
  }))

  return (
    <>
      <nav
        aria-label="Event sections"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-rule-strong bg-nav pb-safe px-safe"
      >
        <ul className="mx-auto grid w-full max-w-[480px] grid-cols-6">
          {primary.map((tab) => {
            const href = tab.segment ? `/${eventCode}/${tab.segment}` : `/${eventCode}`
            const active = current === tab.segment

            return (
              <li key={tab.label} className="relative">
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
                  {/* The state dot and the top rule are decorative — the
                      current tab is announced by aria-current, and named
                      by its own label either way. */}
                  {active ? (
                    <span
                      aria-hidden
                      className="absolute top-0 left-1/2 h-0.5 w-6 -translate-x-1/2 rounded-b-sm bg-brand"
                    />
                  ) : null}
                  <span
                    aria-hidden
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      active ? 'bg-brand' : 'bg-transparent',
                    )}
                  />
                  <span>{tab.label}</span>
                </Link>
              </li>
            )
          })}

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
                moreOpen ? 'text-brand' : 'text-muted active:text-ink',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  moreOpen ? 'bg-brand' : 'bg-transparent',
                )}
              />
              <span>More</span>
            </button>
          </li>
        </ul>
      </nav>

      <MoreSheet
        eventCode={eventCode}
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        items={moreItems}
      />
    </>
  )
}

export default BottomTabs
