'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

import { ChevronLeftIcon, SearchIcon } from '@/components/icons'
import { cn } from '@/lib/utils'

export interface ScreenHeaderProps {
  /** The screen's plain name, 30px in the display face. "Calls", "Rooms". */
  title: string
  /**
   * The small muted line ABOVE the title. One line, no colon, no capitals
   * shouting: "196 of 238 done", "Hotel Grand · floors 2–4", "12 Dec · Hi
   * Priya". Omitted means the title carries the whole header.
   */
  context?: string
  /**
   * Where the back arrow goes. Provide it on a DETAIL screen only — a screen
   * reached by drilling into a row. A tab-level screen has no back arrow:
   * the tab bar underneath is the way out, and a back arrow there would
   * offer a second, slower route to the same place.
   */
  backHref?: string
  /** Announced as the back control's name. Defaults to "Back". */
  backLabel?: string
  /**
   * The round 44px search button that opens Find. On by default: Find is
   * how Guests is reached now that Guests is not a tab, so every staff
   * screen needs the door.
   *
   * Set `false` on a screen where search would be a lie (a proof-capture
   * screen with nothing to search, a login form).
   */
  search?: boolean
  /**
   * Override the search destination. Rarely needed: the default is derived
   * from the current path, and `usePathname` is not available to a caller
   * rendering a header for a DIFFERENT event.
   */
  searchHref?: string
  /** Anything else pinned to the right, left of the search button. */
  actions?: ReactNode
  className?: string
}

/**
 * Split `/SHARMA26/hospitality/deliveries/abc` into its event code and the
 * rest. Route groups — `(app)`, `(staff)` — are stripped, because they are
 * a filesystem detail the proxy rewrites away at the URL level and they
 * would otherwise be mistaken for the event code.
 */
export function splitEventPath(pathname: string | null): {
  eventCode: string | null
  rest: string
} {
  const segments = (pathname ?? '')
    .split('/')
    .filter(Boolean)
    .filter((s) => s !== '(app)' && s !== '(staff)')
  if (segments.length === 0) return { eventCode: null, rest: '' }
  return { eventCode: segments[0] ?? null, rest: segments.slice(1).join('/') }
}

/**
 * The header for every v3 screen: a small muted context line above a 30px
 * display title, with one round search button on the right.
 *
 * WHAT IT REPLACES. AppHeader's stacked eyebrow (mono, uppercase, tracked)
 * over a title — two type treatments competing for the same 40px, one of
 * which was a monospace capital label the v3 look deletes outright. Here
 * there is exactly one loud thing (the title) and one quiet line (the
 * context), and the quiet line is optional.
 *
 * STICKY, NOT FIXED. It participates in layout, so a screen does not have
 * to reserve height for it, and it carries the safe-area top inset because
 * the APK runs `viewport-fit=cover` and draws under the notch.
 */
export function ScreenHeader({
  title,
  context,
  backHref,
  backLabel = 'Back',
  search = true,
  searchHref,
  actions,
  className,
}: ScreenHeaderProps) {
  const pathname = usePathname()
  const { eventCode } = splitEventPath(pathname)
  const findHref = searchHref ?? (eventCode ? `/${eventCode}/find` : null)

  return (
    <header
      className={cn(
        'sticky top-0 z-30 border-b border-rule bg-paper/95 backdrop-blur-sm pt-safe px-safe',
        className,
      )}
    >
      {/* 64px of content: a 20px context line over a 30px title, on 4px
          padding. Deliberately not taller — at 360px every pixel here is a
          pixel the list below does not get. */}
      <div className="mx-auto flex w-full max-w-[480px] items-center gap-2 px-4 py-2">
        {backHref ? (
          <Link
            href={backHref}
            aria-label={backLabel}
            className="tap -ml-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink transition-colors duration-press ease-ledger hover:bg-surface-2 active:bg-surface-2"
          >
            <ChevronLeftIcon className="h-6 w-6" />
          </Link>
        ) : null}

        <div className="min-w-0 flex-1">
          {context ? (
            <p className="truncate text-sm leading-tight text-muted">{context}</p>
          ) : null}
          <h1 className="truncate font-display text-[1.875rem] leading-[1.15] font-semibold tracking-tight text-ink">
            {title}
          </h1>
        </div>

        {actions ? (
          <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
        ) : null}

        {search && findHref ? (
          <Link
            href={findHref}
            aria-label="Find a guest"
            className={cn(
              'tap flex h-11 w-11 shrink-0 items-center justify-center rounded-full',
              'border border-rule-strong bg-surface text-ink shadow-e1',
              'transition-colors duration-press ease-ledger hover:bg-surface-2 active:bg-surface-2',
            )}
          >
            <SearchIcon className="h-5 w-5" />
          </Link>
        ) : null}
      </div>
    </header>
  )
}

export default ScreenHeader
