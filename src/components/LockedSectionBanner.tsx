'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

import { LockIcon } from '@/components/icons'
import { readSectionLocks, type SectionLockState } from '@/lib/actions/section-locks'
import { isLockableSection, type LockableSection } from '@/lib/section-locks'

/**
 * "Locked by admin" (A8).
 *
 * Mounted once by the v2 event shell, for the field team only, and it works out
 * WHICH section it is standing in from the pathname rather than being mounted
 * four times. A locked section is read-only for staff and enforced by a
 * database trigger, so the write is refused whether or not this banner is on
 * screen; the banner exists so a runner is TOLD rather than left tapping a
 * control that silently fails.
 *
 * The lock list is read once per navigation. A failed read renders nothing:
 * the banner is an explanation, and an explanation that cannot be loaded is
 * not a reason to block the screen.
 */
export function LockedSectionBanner({ eventId, eventCode }: { eventId: string; eventCode: string }) {
  const pathname = usePathname()
  const [locks, setLocks] = useState<SectionLockState | null>(null)
  const section = sectionFromPath(pathname, eventCode)

  useEffect(() => {
    let cancelled = false
    readSectionLocks(eventId)
      .then((next) => {
        if (!cancelled) setLocks(next)
      })
      .catch(() => {
        // Read failure: no banner. The trigger still refuses the write.
      })
    return () => {
      cancelled = true
    }
  }, [eventId, pathname])

  if (!section || !locks?.[section]) return null

  return (
    <div
      role="status"
      className="mb-3 flex items-center gap-2.5 rounded-xl border border-ledger-amber/40 bg-amber-tint px-3.5 py-3 text-sm font-medium text-ledger-amber"
    >
      <LockIcon className="h-5 w-5 shrink-0" aria-hidden />
      <span>Locked by admin — this section is read-only. Ask an admin to unlock it.</span>
    </div>
  )
}

/** The first path segment after the event code, when it names a lockable section. */
function sectionFromPath(pathname: string, eventCode: string): LockableSection | null {
  const parts = pathname.split('/').filter(Boolean)
  const index = parts.indexOf(eventCode)
  const segment = index >= 0 ? parts[index + 1] : undefined
  return segment && isLockableSection(segment) ? segment : null
}

export default LockedSectionBanner
