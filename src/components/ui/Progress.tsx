'use client'

import { cn } from '@/lib/utils'
import { progressCount, progressPercent } from '@/lib/ui/metrics'

export type ProgressTone = 'green' | 'brand' | 'amber' | 'neutral'

export interface ProgressProps {
  /** What is being counted, in as few words as possible. */
  label: string
  done: number
  total: number
  /**
   * The domain's colour. Calls are green, Rooms is maroon, Hampers is
   * amber — that mapping lives at the CALL SITE, not here, because it is a
   * statement about the screen rather than about progress bars.
   *
   * `neutral` exists for a bar whose number is not a health signal (a raw
   * count in an admin panel).
   */
  tone?: ProgressTone
  /** Announced for the whole bar when the label + count would be ambiguous. */
  ariaLabel?: string
  className?: string
}

const FILL: Record<ProgressTone, string> = {
  green: 'bg-ledger-green',
  brand: 'bg-brand',
  amber: 'bg-ledger-amber',
  neutral: 'bg-muted',
}

/**
 * `label  done/total` over an 8px bar.
 *
 * The bar is 8px because it is a glance, not a control: it tells a runner
 * "roughly how much is left" from across a corridor, and the exact figure is
 * already spelled out in the right-hand column in tabular numerals. A taller
 * bar would push the list below it off a 360px screen to say the same thing.
 *
 * The right-hand figure is `done/total` — "38/74" — not a percentage. A
 * percentage makes the reader do arithmetic to answer the only question they
 * have ("how many are left"), and it hides the scale.
 */
export function Progress({
  label,
  done,
  total,
  tone = 'brand',
  ariaLabel,
  className,
}: ProgressProps) {
  const percent = progressPercent(done, total)
  const figure = progressCount(done, total)

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-base leading-snug font-medium text-ink">
          {label}
        </span>
        <span className="figure shrink-0 text-sm font-medium text-muted">{figure}</span>
      </div>

      <div
        role="progressbar"
        aria-label={ariaLabel ?? label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={ariaLabel ? `${ariaLabel}: ${figure}` : figure}
        className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
      >
        <div
          // `grow-x` is the left-to-right entrance; on a coarse pointer it is
          // disabled by the media query in globals.css, so a phone renders the
          // final width immediately rather than animating on every paint.
          className={cn('grow-x h-full rounded-full transition-[width] duration-enter', FILL[tone])}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

export default Progress
