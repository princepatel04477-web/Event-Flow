'use client'

import { useEffect } from 'react'

import { drainAllQueues, refreshPending, usePendingSummary } from '@/lib/mutate/pending'
import { scheduleDrain } from '@/lib/outbox/schedule'
import { useOnline } from '@/lib/useOnline'

/**
 * Persistent, non-dismissible offline banner (M9 Part A).
 *
 * Shown whenever the device has no network: "Offline — N changes queued".
 * It must be impossible to miss — no X button, no auto-hide. When the
 * connection returns, the queues are flushed and the banner clears.
 *
 * ── THE COUNT IS NOW EVERY QUEUE, NOT THE PROOF QUEUE (M50) ────────────────
 *
 * This banner is the only global status surface the app has, and it used to read
 * `queuedProofCount()` — one of four IndexedDB outboxes. Queue a call outcome
 * with no signal and the banner said "Offline — 0 changes queued" while the
 * outcome sat unsent in `eventflow-call-outbox`. It did not omit the backlog; it
 * denied it, during a calling shift, which is exactly when the queue is fullest.
 * `docs/BUGS.md` M50.
 *
 * It now reads the shared `pending` store, which sums writes, proofs, call
 * completions and voice notes, and it DRAINS all four from the same trigger.
 * Two consequences worth stating: `navigator.onLine` is a hint rather than the
 * controller — `scheduleDrain` runs on a timer and on foreground as well, because
 * venue Wi-Fi is associated-but-dead and no event ever fires (M23/M24) — and the
 * banner is therefore also the surface that clears itself once the backlog has
 * actually gone, rather than once an event happened to fire.
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
  const pending = usePendingSummary()
  const queued = pending.total

  // Persistent storage (M8/offline): without it Android can evict IndexedDB
  // under storage pressure and take the queues with it. Best-effort —
  // some browsers/WebViews only grant it after a user gesture, and that is
  // fine: the request is a nudge, not a hard requirement.
  useEffect(() => {
    if (navigator.storage?.persist) {
      void navigator.storage.persist()
    }
  }, [])

  // Mount read, so a phone that launches holding a backlog says so immediately.
  useEffect(() => {
    void refreshPending()
  }, [])

  // Every trigger that could get a write through: mount, `online`,
  // `visibilitychange`, and a timer. See `scheduleDrain` for why the timer is
  // not optional on venue Wi-Fi.
  useEffect(() => scheduleDrain(() => drainAllQueues()), [])

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
