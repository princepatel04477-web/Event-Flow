'use client'

import { useEffect, useState } from 'react'

import { queuedProofCount, flushProofQueue } from '@/lib/proof-queue'
import { queuedWriteCount, flushWriteQueue } from '@/lib/mutate/write-queue'
import { listQueuedCompletions } from '@/lib/call/outbox'
import { listQueuedVoiceNotes } from '@/lib/voice-note/outbox'
import { useOnline } from '@/lib/useOnline'

/**
 * Every offline queue this app keeps, summed into the one number the banner
 * shows.
 *
 * It used to count ONLY the proof queue, so a runner with a queued call outcome,
 * a room change and a voice note read "0 changes queued" while three writes sat
 * on the phone unsent. Four queues exist; the banner must speak for all of them:
 *   - proofs        (Dexie, `eventops-proof-queue`)
 *   - reversible writes (Dexie, `eventops-write-queue`)
 *   - call completions (idb, `eventflow-call-outbox`)
 *   - voice notes   (idb, `eventflow-voice-notes`)
 * The last two expose no count helper, so their lists are counted by length.
 */
async function totalQueued(): Promise<number> {
  const [proofs, writes, calls, notes] = await Promise.all([
    queuedProofCount(),
    queuedWriteCount(),
    listQueuedCompletions(),
    listQueuedVoiceNotes(),
  ])
  return proofs + writes + calls.length + notes.length
}

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
    void totalQueued().then(setQueued)
  }, [])

  useEffect(() => {
    if (!online) return
    // Reconnected — send what we can, then re-count EVERY queue. Proofs and
    // reversible writes drain here (both are self-contained modules); the call
    // outbox and voice notes are drained by the screens that own their payloads,
    // and this re-count picks up whatever they managed to send.
    void Promise.allSettled([flushProofQueue(), flushWriteQueue()])
      .then(() => totalQueued())
      .then(setQueued)
  }, [online])

  // Also re-count (and drain) when the app returns to the foreground. Venue
  // Wi-Fi is routinely associated-but-dead, so `navigator.onLine` can stay true
  // forever while nothing is actually getting through — the `online` transition
  // above then never fires, and the count would go stale after a call or a
  // camera capture.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      const done = navigator.onLine
        ? Promise.allSettled([flushProofQueue(), flushWriteQueue()])
        : Promise.resolve()
      void done.then(() => totalQueued()).then(setQueued)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

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
