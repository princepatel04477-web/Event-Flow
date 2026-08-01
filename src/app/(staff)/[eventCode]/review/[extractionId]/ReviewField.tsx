'use client'

import type { ReactNode } from 'react'

import { Badge } from '@/components/ui/Badge'
import { ShieldAlertIcon } from '@/components/icons'
import type { ConfidenceBand } from '@/lib/review/confidence'
import type { FieldState } from '@/lib/review/payload'
import { cn } from '@/lib/utils'

/**
 * The chrome around one reviewable field: confidence colouring, the
 * changed-vs-record marker, and the "not heard clearly" acknowledgement.
 *
 * The control itself is passed in as `children` so Input/Select/Textarea keep
 * their own label/hint/aria wiring — this component owns the *judgement*
 * about the field, not its markup.
 */

const BAND_BORDER: Record<ConfidenceBand, string> = {
  ok: 'border-l-transparent',
  absent: 'border-l-transparent',
  check: 'border-l-warning',
  unclear: 'border-l-danger',
}

/** Label + confidence chip + changed marker, passed to the control's `label`. */
export function FieldLabel({
  children,
  state,
}: {
  children: ReactNode
  state: FieldState
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {children}
      {state.score !== null ? (
        <Badge
          tone={state.band === 'unclear' ? 'danger' : state.band === 'check' ? 'warning' : 'neutral'}
          size="sm"
          className="font-mono"
        >
          {state.band === 'unclear' || state.band === 'check' ? (
            <ShieldAlertIcon className="h-3 w-3" />
          ) : null}
          {Math.round(state.score * 100)}%
        </Badge>
      ) : null}
      {state.changed ? (
        <Badge tone="info" size="sm">
          Changed
        </Badge>
      ) : null}
    </span>
  )
}

export interface ReviewFieldProps {
  state: FieldState
  /** Renders enum codes as the words the reviewer sees elsewhere. */
  format?: (value: string) => string
  /** True once the reviewer has ticked "not heard — leave as is". */
  acknowledged?: boolean
  onAcknowledge?: (next: boolean) => void
  disabled?: boolean
  children: ReactNode
  /** Field-specific messages (invalid number, clear attempt) rendered last. */
  notes?: ReactNode
}

export function ReviewField({
  state,
  format,
  acknowledged = false,
  onAcknowledge,
  disabled = false,
  children,
  notes,
}: ReviewFieldProps) {
  const show = (value: string | null) => {
    if (value === null || value.trim() === '') return null
    return format ? format(value) : value
  }

  const existing = show(state.existing)
  const heard = show(state.extracted)

  return (
    <div className={cn('border-l-4 pl-3', BAND_BORDER[state.band])}>
      {children}

      {state.band === 'check' ? (
        <p className="mt-1 flex items-center gap-1 text-xs font-medium text-warning">
          <ShieldAlertIcon className="h-3.5 w-3.5 shrink-0" />
          Check this against the transcript.
        </p>
      ) : null}

      {state.band === 'unclear' ? (
        <div className="mt-1.5 flex flex-col gap-1.5">
          <p className="flex items-start gap-1 text-xs font-medium text-danger">
            <ShieldAlertIcon className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>
              Not heard clearly — left blank on purpose.
              {heard ? (
                <>
                  {' '}
                  It sounded like &ldquo;{heard}&rdquo;, but not confidently enough to fill in for
                  you.
                </>
              ) : null}{' '}
              Type what they said, or tick below.
            </span>
          </p>

          {onAcknowledge ? (
            <label className="tap flex w-fit items-center gap-2 rounded-lg py-1 text-xs font-medium text-muted">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border-strong accent-danger"
                checked={acknowledged}
                disabled={disabled}
                onChange={(e) => onAcknowledge(e.target.checked)}
              />
              {existing
                ? `Not heard — keep "${existing}"`
                : 'Not heard — leave this empty'}
            </label>
          ) : null}
        </div>
      ) : null}

      {state.changed && existing ? (
        <p className="mt-1 text-xs text-muted">
          Was <span className="font-medium text-fg">{existing}</span> on the record.
        </p>
      ) : null}

      {notes}
    </div>
  )
}

export default ReviewField
