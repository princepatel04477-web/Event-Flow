'use client'

import { useEffect, useState } from 'react'

import { queuedProofCount, flushProofQueue } from '@/lib/proof-queue'
import { useOnline } from '@/lib/useOnline'

/**
 * Persistent, non-dismissible offline banner (M9 Part A).
 *
 * Shown whenever the device has no network: "Offline — N changes queued".
 * It must be impossible to miss — no X button, no auto-hide. When the
 * connection returns, the queued proof queue is flushed and the banner
 * clears.
 */
export function OfflineBanner() {
  const online = useOnline()
  const [queued, setQueued] = useState(0)

  useEffect(() => {
    void queuedProofCount().then(setQueued)
  }, [])

  useEffect(() => {
    if (!online) return
    // Reconnected — flush the write queue, then refresh the count.
    void flushProofQueue().then(() => queuedProofCount().then(setQueued))
  }, [online])

  if (online && queued === 0) return null

  return (
    <div
      role="status"
      className="sticky top-0 z-50 w-full bg-warning px-4 py-2 text-center text-sm font-semibold text-warning-fg"
      style={{ background: '#a35408', color: '#fff9f2' }}
    >
      {online
        ? `${queued} change${queued === 1 ? '' : 's'} queued — will sync when online`
        : `Offline — ${queued} change${queued === 1 ? '' : 's'} queued`}
    </div>
  )
}

export default OfflineBanner
