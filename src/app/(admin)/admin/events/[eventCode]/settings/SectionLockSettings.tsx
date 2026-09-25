'use client'

import { useState, useTransition } from 'react'

import { setSectionLock, type SectionLockState } from '@/lib/actions/section-locks'
import { LOCKABLE_SECTIONS, type LockableSection } from '@/lib/section-locks'
import { cn } from '@/lib/utils'

/**
 * The per-event section lock toggles (A8).
 *
 * Optimistic with rollback, like every other write in this app: the switch
 * flips on the tap and flips back with a message if the server refuses. The
 * refusal is real here — a non-admin's write is answered 42501 by RLS — so the
 * rollback is not decoration.
 */
export function SectionLockSettings({
  eventId,
  initial,
}: {
  eventId: string
  initial: SectionLockState
}) {
  const [locks, setLocks] = useState<SectionLockState>(initial)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function toggle(section: LockableSection, next: boolean) {
    setError(null)
    setLocks((prev) => ({ ...prev, [section]: next }))
    startTransition(async () => {
      const result = await setSectionLock(eventId, section, next)
      if (!result.ok) {
        setLocks((prev) => ({ ...prev, [section]: !next }))
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
        {LOCKABLE_SECTIONS.map(({ id, label }) => {
          const locked = locks[id]
          return (
            <li
              key={id}
              className="flex items-center justify-between gap-3 border-b border-rule px-4 py-3 last:border-b-0"
            >
              <span className="min-w-0">
                <span className="block text-base text-ink">{label}</span>
                <span className="block text-xs text-muted">
                  {locked ? 'Read-only for the field team' : 'Open — staff can edit'}
                </span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={locked}
                aria-label={`${label} locked`}
                disabled={pending}
                onClick={() => toggle(id, !locked)}
                className={cn(
                  'tap shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition-colors duration-press ease-ledger',
                  locked
                    ? 'border-ledger-amber bg-amber-tint text-ledger-amber'
                    : 'border-rule-strong bg-surface text-muted',
                )}
              >
                {locked ? 'Locked' : 'Open'}
              </button>
            </li>
          )
        })}
      </ul>

      <p className="text-sm text-muted">
        A lock is enforced in the database, not just on screen: a staff write to a locked section is
        refused. Admins keep working.
      </p>
    </div>
  )
}

export default SectionLockSettings
