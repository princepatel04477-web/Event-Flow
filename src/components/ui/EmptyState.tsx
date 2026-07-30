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
        'flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border px-6 py-12 text-center',
        className,
      )}
    >
      {icon ? (
        <span
          className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-2 text-muted"
          aria-hidden
        >
          {icon}
        </span>
      ) : null}

      <h2 className="text-lg font-semibold text-fg text-balance">{title}</h2>

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
