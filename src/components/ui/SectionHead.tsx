import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export interface SectionHeadProps {
  /** Small-caps mono eyebrow. */
  eyebrow: string
  /** Optional title under the eyebrow. */
  title?: ReactNode
  /** Right-hand figure — a count, a ratio. Rendered in mono, tabular. */
  right?: ReactNode
  /**
   * Draws the rule as a hairline running from the eyebrow to the right-hand
   * figure instead of underlining the whole block. Use inside a scrolling
   * list, where a full-width underline reads as a divider between rows.
   */
  inline?: boolean
  className?: string
}

/**
 * The section marker: a mono small-caps eyebrow with a hairline.
 *
 * One gray temperature, one line style, everywhere in the app.
 */
export function SectionHead({
  eyebrow,
  title,
  right,
  inline = false,
  className,
}: SectionHeadProps) {
  if (inline) {
    return (
      <div className={cn('flex items-center gap-3', className)}>
        <h2 className="eyebrow shrink-0">{eyebrow}</h2>
        <span aria-hidden className="h-px flex-1 bg-rule-strong" />
        {right ? (
          <span className="figure shrink-0 text-xs text-muted">{right}</span>
        ) : null}
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="eyebrow">{eyebrow}</h2>
        {right ? <span className="figure text-xs text-muted">{right}</span> : null}
      </div>
      {title ? <div className="text-lg leading-snug text-ink">{title}</div> : null}
      {/* Clear of the descenders — at mt-1 the rule cuts through the tail of
          a 'p' or 'y' and reads as a strikethrough. */}
      <span aria-hidden className="mt-2 h-px w-full bg-rule-strong" />
    </div>
  )
}

export default SectionHead
