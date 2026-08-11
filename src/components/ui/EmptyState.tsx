import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export interface EmptyStateProps {
  /** Any node — usually an icon from '@/components/icons'. */
  icon?: ReactNode
  title: string
  description?: ReactNode
  /** Usually a Button or a Link styled as one. */
  action?: ReactNode
  className?: string
}

/**
 * An empty list, drawn on the ledger's paper. Says which filter is hiding
 * the rows and offers one tap to clear it — an empty state invites an
 * action rather than reporting a void.
 *
 * The dashed rule is the ledger's own line style: a ruled paper leaf, not a
 * grey box.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'my-auto flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-rule-strong bg-paper px-6 py-12 text-center',
        className,
      )}
    >
      {icon ? (
        <span
          className="flex h-14 w-14 items-center justify-center rounded-full bg-paper-band text-muted"
          aria-hidden
        >
          {icon}
        </span>
      ) : null}

      {/* Sans, not the display serif — see the note in ErrorState. The three
          places Cormorant is allowed are screen titles, the couple's names
          and the seal. */}
      <h2 className="text-lg font-medium text-balance text-ink">{title}</h2>

      {description ? (
        <p className="max-w-sm text-base leading-relaxed text-muted text-pretty">
          {description}
        </p>
      ) : null}

      {action ? <div className="mt-2 w-full max-w-xs">{action}</div> : null}
    </div>
  )
}

export default EmptyState
