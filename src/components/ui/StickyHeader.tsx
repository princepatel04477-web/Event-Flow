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
  /** Actions pinned to the right of the title row. */
  right?: ReactNode
  /** A second row under the title — filters, tabs, a search box. */
  children?: ReactNode
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
  className,
}: StickyHeaderProps) {
  return (
    <header
      className={cn(
        'sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur-sm pt-safe px-safe',
        className,
      )}
    >
      <div className="mx-auto flex w-full max-w-[480px] items-center gap-2 px-3 py-2">
        {backHref ? (
          <Link
            href={backHref}
            aria-label={backLabel}
            className="tap -ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-fg hover:bg-surface-2"
          >
            <ChevronLeftIcon className="h-6 w-6" />
          </Link>
        ) : null}

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg leading-tight font-semibold text-fg">{title}</h1>
          {subtitle ? (
            <p className="truncate text-sm leading-tight text-muted">{subtitle}</p>
          ) : null}
        </div>

        {right ? <div className="flex shrink-0 items-center gap-1">{right}</div> : null}
      </div>

      {children ? (
        <div className="mx-auto w-full max-w-[480px] px-3 pb-2">{children}</div>
      ) : null}
    </header>
  )
}

export default StickyHeader
