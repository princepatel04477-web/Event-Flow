import { cn } from '@/lib/utils'

export interface LoadingRowsProps {
  /** Number of skeleton rows. Defaults to 6. */
  count?: number
  className?: string
}

/**
 * Skeleton rows that match `ListRow`, so a list does not jump when the data
 * lands — the skeleton is the same shape as the real row it replaces.
 *
 * Never a spinner for a known layout: a list has a shape, so it gets a
 * skeleton. Rows fade out as the real ones fade in; both use the same
 * 150ms list fade.
 */
export function LoadingRows({ count = 6, className }: LoadingRowsProps) {
  return (
    <div
      className={cn('list-fade flex flex-col', className)}
      aria-hidden
      role="status"
      aria-label="Loading"
    >
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className={cn(
            'flex min-h-14 items-center gap-3 px-3 py-2.5',
            i % 2 === 1 && 'bg-paper-band',
          )}
        >
          <div className="min-w-0 flex-1">
            <div className="h-5 w-2/5 rounded bg-rule-strong" />
            <div className="mt-1.5 h-3.5 w-1/4 rounded bg-rule" />
          </div>
          <div className="h-6 w-20 rounded-md bg-rule" />
        </div>
      ))}
    </div>
  )
}

export default LoadingRows
