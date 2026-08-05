import type { HTMLAttributes } from 'react'

import { cn } from '@/lib/utils'
import { UploadIcon } from '@/components/icons'

export interface SyncChipProps extends HTMLAttributes<HTMLButtonElement> {
  /** How many writes are queued, waiting for a connection. */
  count: number
  /** Where they will go — "deliveries", "call outcomes". */
  what: string
  onPress?: () => void
}

/**
 * "3 waiting to upload" — the offline queue surfaced without ceremony. A
 * staff member in a corridor with no signal needs to know their write is
 * safe, and to see the list of what is waiting with one tap.
 *
 * Only rendered when `count > 0`. Zero waiting is nothing to say.
 */
export function SyncChip({ count, what, onPress, className, ...props }: SyncChipProps) {
  if (count <= 0) return null

  const noun = count === 1 ? what : `${what}s`

  return (
    <button
      type="button"
      onClick={onPress}
      className={cn(
        'tap inline-flex min-h-9 items-center gap-1.5 rounded-md border border-rule-strong bg-surface px-2.5 text-sm text-muted',
        'transition-colors duration-100 hover:bg-surface-2 active:bg-surface-2',
        className,
      )}
      {...props}
    >
      <UploadIcon className="h-4 w-4" aria-hidden />
      <span className="tabular-nums">{count}</span>
      <span>waiting to upload · {noun}</span>
    </button>
  )
}

export default SyncChip
