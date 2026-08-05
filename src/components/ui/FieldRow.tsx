import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export interface FieldRowProps {
  /** The label — what this value means. */
  label: string
  /** The value. Pass a node; numbers get the mono face via `mono`. */
  value?: ReactNode
  /** Renders the value in the tabular mono face (numbers, rooms, times). */
  mono?: boolean
  /** Renders the value in the attention colour (an unbalanced figure). */
  attention?: boolean
  className?: string
}

/** The fixed text for a value that was never captured. */
export const NOT_YET_CONFIRMED = 'Not yet confirmed'

/**
 * A labelled value on the ledger. The label is secondary text; the value is
 * the figure, in mono when it is a number so a column of them lines up.
 *
 * A null value reads "Not yet confirmed" — never a blank, never a dash. A
 * missing number is itself information: the field was asked and not
 * answered.
 */
export function FieldRow({
  label,
  value,
  mono = false,
  attention = false,
  className,
}: FieldRowProps) {
  const hasValue = value !== undefined && value !== null && value !== ''

  return (
    <div className={cn('flex items-baseline justify-between gap-3', className)}>
      <span className="text-sm text-muted">{label}</span>
      <span
        className={cn(
          'text-right text-base',
          mono && 'font-mono tabular-nums',
          attention ? 'font-medium text-ledger-red' : 'text-ink',
          !hasValue && 'text-muted',
        )}
      >
        {hasValue ? value : NOT_YET_CONFIRMED}
      </span>
    </div>
  )
}

export default FieldRow
