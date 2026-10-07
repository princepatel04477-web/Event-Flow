'use client'

import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/Button'
import {
  flushWriteQueue,
  stuckWrites,
  type QueuedWrite,
} from '@/lib/mutate/write-queue'

/**
 * "2 changes could not be sent" [Retry].
 *
 * THE GAP THIS CLOSES. `stuckWrites()` existed on the write queue but had **no
 * caller anywhere**, so a room change or an RSVP outcome the server kept
 * refusing simply disappeared into IndexedDB: the row showing what the runner
 * set stayed on screen, the queue count eventually stopped saying it was
 * waiting, and nothing ever told them it was not saved. The product rule is
 * "surface after 3 failures with a manual Retry"; this is that surface.
 *
 * WHERE IT LIVES. It renders inside `UndoBar`'s persistent `bottom-nav` live
 * region rather than as a second fixed bar, so the two can never overlap and
 * the notice is announced (the region is present and its CONTENT changes).
 * UndoBar is mounted by BOTH event shells, so this needs no new mount point.
 *
 * IT NEVER SENDS ANYTHING BY ITSELF. Retry re-runs the same `flushWriteQueue`
 * the reconnect path uses; if the link is still dead the rows stay, and the
 * copy stays honest ("still saved on this phone").
 */
export function StuckWritesNotice() {
  const [stuck, setStuck] = useState<QueuedWrite[]>([])
  const [retrying, setRetrying] = useState(false)

  const refresh = useCallback(() => {
    void stuckWrites()
      .then(setStuck)
      .catch(() => {
        /* a failed count is not worth surfacing; the next refresh tries again */
      })
  }, [])

  useEffect(() => {
    refresh()
    // Venue Wi-Fi is associated-but-dead often enough that neither an `online`
    // transition nor a remount can be relied on to re-check. A foreground
    // re-check plus a slow interval is what makes the surface actually appear
    // on a handset that has been sitting on one screen all shift.
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    const timer = window.setInterval(refresh, 30_000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
    }
  }, [refresh])

  const retry = useCallback(() => {
    setRetrying(true)
    void flushWriteQueue()
      .catch(() => {})
      .then(() => refresh())
      .finally(() => setRetrying(false))
  }, [refresh])

  if (stuck.length === 0) return null

  const count = stuck.length
  return (
    <div className="mx-auto w-full max-w-[480px] px-4 pb-2">
      <div className="flex items-start gap-2 rounded-xl border border-ledger-red/40 bg-surface py-2 pl-4 pr-2 shadow-e3">
        <span className="min-w-0 flex-1 text-sm leading-snug text-ink">
          <span className="block font-medium">
            {count === 1 ? '1 change' : `${count} changes`} could not be sent.
          </span>
          <span className="mt-0.5 block text-muted">
            Your {stuck[0].what} {count === 1 ? 'is' : 'are'} still saved on this phone. Tap
            Retry when you have signal.
          </span>
        </span>
        <Button
          size="md"
          variant="secondary"
          onClick={retry}
          loading={retrying}
          className="shrink-0"
        >
          Retry
        </Button>
      </div>
    </div>
  )
}

export default StuckWritesNotice
