import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export interface SectionHeadProps {
  /** Small-caps eyebrow. */
  eyebrow: string
  /** Optional title under the eyebrow. */
  title?: ReactNode
  className?: string
}

/**
 * The ledger's section marker: a small-caps eyebrow over a ruled underline.
 * The rule is the same ink hairline as every other rule in the app — one
 * gray temperature, one line style.
 */
export function SectionHead({ eyebrow, title, className }: SectionHeadProps) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <h2 className="text-xs font-semibold tracking-[0.14em] text-muted uppercase">
        {eyebrow}
      </h2>
      {title ? <div className="text-lg text-ink">{title}</div> : null}
      <span aria-hidden className="mt-1 h-px w-full bg-rule-strong" />
    </div>
  )
}

export default SectionHead
