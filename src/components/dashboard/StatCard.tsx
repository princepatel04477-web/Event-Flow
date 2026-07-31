import type { ReactNode } from 'react'

import { Card } from '@/components/ui/Card'
import { cn, formatCount } from '@/lib/utils'

export type StatTone = 'neutral' | 'success' | 'warning' | 'info'

export interface StatCardProps {
  label: string
  value: number | null | undefined
  icon?: ReactNode
  tone?: StatTone
  /** Small line under the number — units, or what "today" means. */
  note?: string
  className?: string
}

const TONES: Record<StatTone, string> = {
  neutral: 'text-fg',
  success: 'text-success',
  warning: 'text-warning',
  info: 'text-info',
}

const ICON_TONES: Record<StatTone, string> = {
  neutral: 'bg-tint-neutral text-muted',
  success: 'bg-tint-success text-success',
  warning: 'bg-tint-warning text-warning',
  info: 'bg-tint-info text-info',
}

/**
 * One dashboard counter. Big enough to read at arm's length and to tap by
 * mistake without consequence — these are read-only.
 */
export function StatCard({
  label,
  value,
  icon,
  tone = 'neutral',
  note,
  className,
}: StatCardProps) {
  return (
    <Card className={cn('h-full', className)}>
      <div className="flex min-h-28 flex-col justify-between gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm leading-tight font-medium text-muted">{label}</span>
          {icon ? (
            <span
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                ICON_TONES[tone],
              )}
              aria-hidden
            >
              {icon}
            </span>
          ) : null}
        </div>

        <div>
          <span
            className={cn(
              'block text-4xl leading-none font-bold tabular-nums',
              TONES[tone],
            )}
          >
            {formatCount(value)}
          </span>
          {note ? <span className="mt-1 block text-xs text-subtle">{note}</span> : null}
        </div>
      </div>
    </Card>
  )
}

export default StatCard
