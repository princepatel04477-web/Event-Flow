/**
 * The retry schedule every offline queue shares (M24).
 *
 * WHY THIS IS ONE MODULE AND NOT FOUR COPIES OF THE SAME ARITHMETIC.
 *
 * There are four IndexedDB outboxes in this app — writes, proofs, call
 * completions, voice notes — and they were written at four different times. Only
 * one of them (`write-queue.ts`) actually honoured a backoff and drained on
 * foreground. The other three attempted everything on every trigger, and their
 * only trigger was mount plus the browser's `online` event. On venue Wi-Fi that
 * is associated-but-dead, `online` never fires again, so a proof photographed at
 * 11am was retried at the next full app launch and never before. The doc comment
 * in `proof-queue.ts` claimed a backoff it did not implement; `call/outbox.ts`
 * incremented an `attempts` counter that nothing read.
 *
 * The bug was not the arithmetic (which is four lines). It was that the
 * arithmetic existed in one file and the other three files had no way to know
 * that. So it lives here, once, and each queue calls `isDue`.
 *
 * TWO PROTOCOLS ARE SUPPORTED, because the four queues genuinely carry different
 * facts and normalising them would mean a migration of persisted rows:
 *
 *   count-based  `retries` counts FAILED attempts. Retry `n` (1-based) is due
 *                `createdAt + backoffMs(n - 1)` after the row was queued. This
 *                is `write-queue.ts` and `proof-queue.ts`.
 *    time-based   `attempts` counts attempts and the row carries `queuedAt`.
 *                Retry `n` is due `queuedAt + backoffMs(n - 1)`. This is
 *                `call/outbox.ts` and `voice-note/outbox.ts`, where `attempts`
 *                was already being written and simply never read.
 *
 * Both reduce to the same question — "has enough time passed since this row's
 * Nth attempt?" — and both are answered by one function.
 */

/** Backoff before retry `retries + 1`. Doubles from 2s, capped at 60s. */
export function backoffMs(retries: number): number {
  return Math.min(60_000, Math.pow(2, retries) * 2_000)
}

/** How many attempts before a row is surfaced as needing attention. */
export const STUCK_AFTER_RETRIES = 5

/** The count-based shape: `retries` failed attempts, stamped by `createdAt`. */
export interface CountedRow {
  retries: number
  createdAt: number
}

/**
 * Is this row due for another attempt?
 *
 * `now` is a parameter rather than a call to `Date.now()` inside, so the
 * schedule is testable without freezing the clock — and a schedule that is only
 * exercised through a fake timer is a schedule nobody has watched fail.
 */
export function isCountedDue(row: CountedRow, now: number = Date.now()): boolean {
  if (row.retries <= 0) return true
  return now >= row.createdAt + backoffMs(row.retries - 1)
}

/** The time-based shape: `attempts` and an ISO `queuedAt`. */
export interface AttemptedRow {
  attempts: number
  queuedAt: string
}

export function isAttemptedDue(row: AttemptedRow, now: number = Date.now()): boolean {
  if (row.attempts <= 0) return true
  const queuedAt = Date.parse(row.queuedAt)
  // An unparseable stamp must not park the row forever: a malformed date is a
  // reason to attempt the write now, not a reason to drop the user's data.
  if (!Number.isFinite(queuedAt)) return true
  return now >= queuedAt + backoffMs(row.attempts - 1)
}

/* --------------------------------------------------------------------- */
/* When the queues are drained                                            */
/* --------------------------------------------------------------------- */

/** Flush no more often than this while the app stays open and online. */
export const DRAIN_INTERVAL_MS = 15_000

/**
 * Run `drain` on every moment a queued write could plausibly get through.
 *
 * THE FOUR TRIGGERS, and why each is here:
 *
 *   mount             the app was launched holding a backlog.
 *   online            the network came back — the one trigger the old code had.
 *   visibilitychange  returning from a dial, or from another app. `tel:`
 *                     backgrounds the WebView on every call (CLAUDE.md §12), so
 *                     during a calling shift this fires constantly — which is
 *                     exactly when a link that had failed is most likely to
 *                     work again. `write-queue` was fixed for this case and the
 *                     other three were not.
 *   interval          the associated-but-dead case: `navigator.onLine` is true
 *                     and never changes, so no event will ever fire. Without a
 *                     timer the backlog waits for the next launch. 15s is
 *                     frequent enough that a runner never sees a stale "3
 *                     waiting" chip for long, and the per-row backoff (above)
 *                     means the timer cannot turn into a retry storm.
 *
 * Returns a teardown function. `drain` may be called concurrently with itself
 * from two triggers in the same tick; every queue's own drain is either
 * serialised (`write-queue`) or idempotent per row, so that is safe by design
 * rather than by luck.
 */
export function scheduleDrain(drain: () => void | Promise<void>): () => void {
  if (typeof window === 'undefined') return () => {}

  const run = () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    void drain()
  }

  const onVisible = () => {
    if (document.visibilityState === 'visible') run()
  }

  // Mount, but on the next macrotask rather than during the commit — a drain
  // that resolves synchronously would otherwise call back into a hook that has
  // not finished mounting.
  const initial = window.setTimeout(run, 0)
  const interval = window.setInterval(run, DRAIN_INTERVAL_MS)

  window.addEventListener('online', run)
  document.addEventListener('visibilitychange', onVisible)

  return () => {
    window.clearTimeout(initial)
    window.clearInterval(interval)
    window.removeEventListener('online', run)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
