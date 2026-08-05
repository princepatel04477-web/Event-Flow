import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'
import { ShieldAlertIcon } from '@/components/icons'
import { Button } from './Button'

export interface ErrorStateProps {
  /** The real error, in plain words. What went wrong and what to do. */
  title: string
  /** Optional detail — never an error code, always a next step. */
  description?: ReactNode
  /** Retry handler. Renders a Retry button when set. */
  onRetry?: () => void
  className?: string
}

/**
 * The error face of the ledger. Shows the real error and a one-tap Retry —
 * never a blank screen, never a spinner that can never resolve.
 *
 * Red is the attention colour and only appears here for a reason: a load
 * failure is a live gap. The message says what to do ("Check your
 * connection and try again"), not what the code thinks went wrong.
 */
export function ErrorState({
  title,
  description,
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-2xl border border-red-tint bg-red-tint px-6 py-12 text-center',
        className,
      )}
    >
      <span
        className="flex h-14 w-14 items-center justify-center rounded-full bg-red-tint text-ledger-red"
        aria-hidden
      >
        <ShieldAlertIcon className="h-7 w-7" />
      </span>

      <h2 className="font-display text-lg text-ledger-red text-balance">{title}</h2>

      {description ? (
        <p className="max-w-sm text-base leading-relaxed text-ink text-pretty">
          {description}
        </p>
      ) : null}

      {onRetry ? (
        <div className="mt-2 w-full max-w-xs">
          <Button variant="secondary" fullWidth onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : null}
    </div>
  )
}

export default ErrorState
