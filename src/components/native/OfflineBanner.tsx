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
 *
 * ── `offlineNote`, and why v1 does not pass it ─────────────────────────────
 * An optional second line, shown ONLY while offline. It exists so the new UI
 * can carry the one training sentence from CLAUDE.md §11b — "don't reload and
 * don't press back" — without a second banner and without this component
 * knowing which UI it is in.
 *
 * v1 passes nothing, so with the prop absent every branch below is the original
 * markup: same element, same classes, same text, same conditions. That is the
 * only shape an edit to a file the live app renders may take, and it is why the
 * note is a PROP rather than a check of `process.env.NEXT_PUBLIC_UI`. That env
 * var is inlined at build time in a client bundle while the proxy reads it at
 * runtime, so a banner deciding for itself could disagree with the server that
 * chose the route; the v2 layout is a server component and hands the string
 * down instead.
 */
export interface OfflineBannerProps {
  /** One sentence of recovery advice. Only rendered while offline. */
  offlineNote?: string
}

export function OfflineBanner({ offlineNote }: OfflineBannerProps = {}) {
  const online = useOnline()
  const [queued, setQueued] = useState(0)

  // Persistent storage (M8/offline): without it Android can evict IndexedDB
  // under storage pressure and take the proof queue with it. Best-effort —
  // some browsers/WebViews only grant it after a user gesture, and that is
  // fine: the request is a nudge, not a hard requirement.
  useEffect(() => {
    if (navigator.storage?.persist) {
      void navigator.storage.persist()
    }
  }, [])

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
      {!online && offlineNote ? (
        // The ground here is the hardcoded dark amber above, so this line uses
        // the same light-on-dark pair the headline already wears, at a lighter
        // weight — a token such as `text-muted` would be charcoal on amber and
        // unreadable in exactly the light this banner exists for.
        <p className="mt-1 text-xs leading-snug font-normal" style={{ color: '#fff9f2' }}>
          {offlineNote}
        </p>
      ) : null}
    </div>
  )
}

export default OfflineBanner
