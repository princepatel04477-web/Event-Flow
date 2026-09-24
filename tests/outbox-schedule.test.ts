import { describe, expect, it } from 'vitest'

import {
  DRAIN_INTERVAL_MS,
  STUCK_AFTER_RETRIES,
  backoffMs,
  isAttemptedDue,
  isCountedDue,
} from '@/lib/outbox/schedule'

/**
 * The retry schedule every offline queue shares (M23/M24).
 *
 * WHY THESE ASSERTIONS EXIST AT ALL. The bug was not a wrong number — it was
 * that three of the four queues had NO number and no trigger. So the tests that
 * matter are the ones that pin the CONTRACT the queues now share: a row is
 * attemptable immediately, then held for a growing window, then capped; and the
 * two row shapes (count-based `retries`, time-based `attempts`+`queuedAt`) agree
 * about when retry N is due.
 */
describe('backoffMs', () => {
  it('doubles from 2s', () => {
    expect(backoffMs(0)).toBe(2_000)
    expect(backoffMs(1)).toBe(4_000)
    expect(backoffMs(2)).toBe(8_000)
    expect(backoffMs(3)).toBe(16_000)
  })

  it('caps at 60s rather than growing without bound', () => {
    expect(backoffMs(5)).toBe(60_000)
    expect(backoffMs(20)).toBe(60_000)
    expect(backoffMs(200)).toBe(60_000)
  })
})

describe('isCountedDue — the write/proof queue shape', () => {
  const queuedAt = 1_700_000_000_000

  it('is due immediately when it has never failed', () => {
    expect(isCountedDue({ retries: 0, createdAt: queuedAt }, queuedAt)).toBe(true)
  })

  it('holds a row for the full window after its first failure', () => {
    const row = { retries: 1, createdAt: queuedAt }
    // The first window is 2s: a drain just before it is not due...
    expect(isCountedDue(row, queuedAt + 1_999)).toBe(false)
    // ...and one at exactly 2s is, because `>=` is the boundary the old
    // write-queue used and tightening it would delay every retry by a tick.
    expect(isCountedDue(row, queuedAt + 2_000)).toBe(true)
  })

  it('grows the window with each failure', () => {
    const row = { retries: 3, createdAt: queuedAt }
    // Retry 3 waits 8s. Four seconds in — long past the FIRST window — it is
    // still held, which is the property a flat retry had and this does not.
    expect(isCountedDue(row, queuedAt + 4_000)).toBe(false)
    expect(isCountedDue(row, queuedAt + 7_999)).toBe(false)
    expect(isCountedDue(row, queuedAt + 8_000)).toBe(true)
  })
})

describe('isAttemptedDue — the call-outbox/voice-note shape', () => {
  const queuedAt = '2026-12-20T10:00:00.000Z'
  const base = Date.parse(queuedAt)

  it('is due immediately when it has never been attempted', () => {
    expect(isAttemptedDue({ attempts: 0, queuedAt }, base)).toBe(true)
  })

  it('agrees with isCountedDue for the same attempt count', () => {
    // Two rows queued at the same instant, one described each way. Retry 3 must
    // come due at the same millisecond or the four queues drift apart again.
    for (const attempts of [1, 2, 3, 4, 5]) {
      const counted = isCountedDue({ retries: attempts, createdAt: base }, base + backoffMs(attempts - 1))
      const attempted = isAttemptedDue({ attempts, queuedAt }, base + backoffMs(attempts - 1))
      expect(attempted).toBe(counted)
      expect(attempted).toBe(true)
    }
  })

  it('treats an unparseable stamp as due rather than parking the row', () => {
    // A malformed date must not hold a user's voice note forever. Attempting it
    // again is recoverable; never attempting it is not.
    expect(isAttemptedDue({ attempts: 9, queuedAt: 'not-a-date' }, base)).toBe(true)
  })
})

describe('the drain interval', () => {
  it('is short enough that a runner never watches a stale chip', () => {
    // The associated-but-dead case has no event to fire on, so this interval IS
    // the retry cadence. A minute would be visible as "still waiting"; the
    // per-row backoff, not this number, is what prevents a retry storm.
    expect(DRAIN_INTERVAL_MS).toBeLessThanOrEqual(30_000)
    expect(DRAIN_INTERVAL_MS).toBeGreaterThanOrEqual(5_000)
  })

  it('surfaces a row as stuck after a handful of attempts', () => {
    expect(STUCK_AFTER_RETRIES).toBe(5)
  })
})
