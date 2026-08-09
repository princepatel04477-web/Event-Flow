import Link from 'next/link'
import type { CSSProperties } from 'react'

import { cn, formatCount } from '@/lib/utils'

export type StatTone = 'neutral' | 'success' | 'warning' | 'info'

export interface StatCardProps {
  label: string
  value: number | string | null | undefined
  tone?: StatTone
  /** Small line under the number — units, or what "today" means. */
  note?: string
  /** Makes the whole tile a link to the screen this counter is about. */
  href?: string
  style?: CSSProperties
  className?: string
}

const TONES: Record<StatTone, string> = {
  neutral: 'text-ink',
  success: 'text-ledger-green',
  warning: 'text-brand',
  info: 'text-muted',
}

/**
 * One dashboard counter.
 *
 * A counter is a question ("how many are still pending?") and the answer is
 * always on another screen, so the whole tile is the target — 96px of it,
 * which is a thumb-sized hit area without a separate "view" affordance.
 *
 * No icon. The mockup drops them deliberately: six tiles in a 2-column grid
 * on a 390px screen, each with a glyph, reads as a toolbar rather than a
 * set of figures, and the figure is the only thing anyone is here to read.
 */
export function StatCard({
  label,
  value,
  tone = 'neutral',
  note,
  href,
  style,
  className,
}: StatCardProps) {
  const body = (
    <>
      <span className="eyebrow leading-tight">{label}</span>
      <span className={cn('figure block text-3xl leading-none font-medium', TONES[tone])}>
        {typeof value === 'string' ? value : formatCount(value)}
      </span>
      {note ? (
        <span className="block text-xs leading-snug text-muted">{note}</span>
      ) : (
        // Reserves the note's line so a tile with a note and a tile without
        // still line their figures up across the grid.
        <span aria-hidden className="block text-xs leading-snug">
          &nbsp;
        </span>
      )}
    </>
  )

  const shell = cn(
    'list-fade flex min-h-24 flex-col justify-between gap-2 rounded-xl',
    'border border-rule bg-surface p-3.5',
    href &&
      'tap cursor-pointer transition-colors duration-press ease-ledger ' +
        'hover:bg-surface-2 active:bg-surface-2',
    className,
  )

  if (href) {
    return (
      <Link href={href} style={style} className={shell}>
        {body}
      </Link>
    )
  }

  return (
    <div style={style} className={shell}>
      {body}
    </div>
  )
}

export default StatCard
