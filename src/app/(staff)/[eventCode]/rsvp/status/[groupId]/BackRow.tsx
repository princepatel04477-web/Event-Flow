import Link from 'next/link'
import type { ReactNode } from 'react'

import { ChevronLeftIcon } from '@/components/icons'
import { cn } from '@/lib/utils'

export interface BackRowProps {
  href: string
  title: ReactNode
  subtitle?: ReactNode
  right?: ReactNode
  className?: string
}

/**
 * Local back-navigation row for screens nested under `[eventCode]`.
 *
 * Deliberately NOT a `StickyHeader` — the event layout already renders one
 * sticky header (event name + switcher) per screen. Stacking a second
 * `position: sticky` element inside that layout's padded content wrapper
 * does not cascade cleanly, so this renders in normal flow instead.
 */
export function BackRow({ href, title, subtitle, right, className }: BackRowProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Link
        href={href}
        aria-label="Back to queue"
        className="tap -ml-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-fg hover:bg-surface-2"
      >
        <ChevronLeftIcon className="h-6 w-6" />
      </Link>

      <div className="min-w-0 flex-1">
        <h1 className="truncate text-lg leading-tight font-semibold text-fg">{title}</h1>
        {subtitle ? <p className="truncate text-sm leading-tight text-muted">{subtitle}</p> : null}
      </div>

      {right ? <div className="flex shrink-0 items-center gap-1">{right}</div> : null}
    </div>
  )
}

export default BackRow
