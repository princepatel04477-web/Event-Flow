import Link from 'next/link'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'
import { ChevronLeftIcon } from '@/components/icons'

export interface StickyHeaderProps {
  title: ReactNode
  subtitle?: ReactNode
  /** Renders a 44px back target on the left. */
  backHref?: string
  backLabel?: string
  /** Actions or a figure pinned to the right of the title row. */
  right?: ReactNode
  /** A second row under the title — filters, tabs, a search box. */
  children?: ReactNode
  /**
   * `screen` is the section title: uppercase and tracked — "CALL QUEUE",
   * "ROOMS", "FLEET". `entity` is a specific thing you have drilled into
   * (a family, a room), set without the tracking because those names are
   * frequently Devanagari.
   *
   * The tracking was 0.14em, set when this was Cormorant Garamond — a
   * narrow display serif that could afford it. Be Vietnam Pro is a wide
   * grotesque, and at 0.14em an event name truncated to "NUVENT EV…" after
   * ten characters on a 400px handset. 0.05em is the design language's own
   * label tracking and buys back roughly a third of the line.
   */
  variant?: 'screen' | 'entity'
  className?: string
}

/**
 * The top bar for every screen. Sticky rather than fixed so it participates
 * in layout, and safe-area padded because the APK runs viewport-fit=cover.
 */
export function StickyHeader({
  title,
  subtitle,
  backHref,
  backLabel = 'Back',
  right,
  children,
  variant = 'screen',
  className,
}: StickyHeaderProps) {
  return (
    <header
      className={cn(
        'sticky top-0 z-30 border-b border-rule bg-paper/95 backdrop-blur-sm pt-safe px-safe',
        className,
      )}
    >
      <div className="mx-auto flex w-full max-w-[480px] items-center gap-2 px-4 py-2.5">
        {backHref ? (
          <Link
            href={backHref}
            aria-label={backLabel}
            className="tap -ml-2.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted hover:bg-surface-2 active:bg-surface-2"
          >
            <ChevronLeftIcon className="h-6 w-6" />
          </Link>
        ) : null}

        <div className="min-w-0 flex-1">
          <h1
            className={cn(
              'truncate text-ink',
              variant === 'screen'
                ? 'font-display text-xl leading-none font-semibold tracking-[0.05em] uppercase'
                : 'text-lg leading-tight font-medium',
            )}
          >
            {title}
          </h1>
          {subtitle ? (
            <p
              className={cn(
                'truncate leading-tight text-muted',
                variant === 'screen' ? 'mt-1.5 text-sm' : 'mt-0.5 font-mono text-xs',
              )}
            >
              {subtitle}
            </p>
          ) : null}
        </div>

        {right ? (
          <div className="flex shrink-0 items-center gap-1.5 font-mono text-xs text-muted">
            {right}
          </div>
        ) : null}
      </div>

      {children ? (
        <div className="mx-auto w-full max-w-[480px] px-4 pb-3">{children}</div>
      ) : null}
    </header>
  )
}

export default StickyHeader
