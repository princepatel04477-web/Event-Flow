'use client'

import { useState, useTransition } from 'react'

import { setArrivalsNotify } from '@/lib/actions/arrivals'
import { cn } from '@/lib/utils'

/**
 * The arrival-notification switch (A9).
 *
 * Optimistic with rollback, like the section locks beside it. When it is off,
 * the in-app banner is gone for everyone on the event; push (where configured)
 * follows the same switch.
 */
export function NotificationSettings({
  eventId,
  initial,
}: {
  eventId: string
  initial: boolean
}) {
  const [enabled, setEnabled] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function toggle(next: boolean) {
    setError(null)
    setEnabled(next)
    startTransition(async () => {
      const result = await setArrivalsNotify(eventId, next)
      if (!result.ok) {
        setEnabled(!next)
        setError(result.error)
      }
    })
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-ledger-red/40 bg-red-tint px-3.5 py-3 text-sm font-medium text-ledger-red"
        >
          {error}
        </p>
      ) : null}

      <ul className="overflow-hidden rounded-2xl border border-rule-strong bg-surface">
        <li className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="min-w-0">
            <span className="block text-base text-ink">Arrival notifications</span>
            <span className="block text-xs text-muted">
              {enabled
                ? 'Banner on Today and Logistics, live'
                : 'Off — no arrival banner for the field team'}
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="Arrival notifications on"
            disabled={pending}
            onClick={() => toggle(!enabled)}
            className={cn(
              'tap shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition-colors duration-press ease-ledger',
              enabled
                ? 'border-ledger-green bg-green-tint text-ledger-green'
                : 'border-rule-strong bg-surface text-muted',
            )}
          >
            {enabled ? 'On' : 'Off'}
          </button>
        </li>
      </ul>
    </div>
  )
}

export default NotificationSettings
