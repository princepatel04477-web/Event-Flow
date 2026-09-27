import { describe, expect, it } from 'vitest'

import { pullDistance, pullProgress, shouldRefresh } from '@/lib/motion/pull'
import { DISTANCE, advanceVariants } from '@/lib/motion/tokens'

/**
 * The feel of pull-to-refresh lives on a phone (docs/HANDSET-TEST.md), but the
 * numbers that decide WHEN it refreshes are pinned here.
 */
describe('pullDistance', () => {
  it('does not move for an upward or zero drag', () => {
    expect(pullDistance(0)).toBe(0)
    expect(pullDistance(-40)).toBe(0)
  })

  it('tracks the finger almost 1:1 for a short drag', () => {
    expect(pullDistance(10)).toBeGreaterThan(9)
    expect(pullDistance(10)).toBeLessThanOrEqual(10)
  })

  it('never passes the maximum, however far the finger goes', () => {
    expect(pullDistance(10_000)).toBeLessThanOrEqual(DISTANCE.pullMax)
    expect(pullDistance(10_000)).toBeGreaterThan(DISTANCE.pullMax - 1)
  })

  it('only grows as the finger moves further', () => {
    let prev = 0
    for (let dy = 1; dy <= 400; dy += 7) {
      const next = pullDistance(dy)
      expect(next).toBeGreaterThan(prev)
      prev = next
    }
  })

  it('reaches the trigger after a comfortable thumb travel (90-130px)', () => {
    expect(shouldRefresh(pullDistance(90))).toBe(false)
    expect(shouldRefresh(pullDistance(130))).toBe(true)
  })
})

describe('shouldRefresh / pullProgress', () => {
  it('refreshes exactly at the trigger and beyond', () => {
    expect(shouldRefresh(DISTANCE.pullTrigger - 0.5)).toBe(false)
    expect(shouldRefresh(DISTANCE.pullTrigger)).toBe(true)
  })

  it('reports progress from 0 to 1 and clamps', () => {
    expect(pullProgress(0)).toBe(0)
    expect(pullProgress(DISTANCE.pullTrigger / 2)).toBeCloseTo(0.5)
    expect(pullProgress(DISTANCE.pullMax)).toBe(1)
  })

  it('rests the indicator short of the trigger, inside the maximum', () => {
    expect(DISTANCE.pullHold).toBeLessThan(DISTANCE.pullTrigger)
    expect(DISTANCE.pullTrigger).toBeLessThan(DISTANCE.pullMax)
  })
})

describe('advanceVariants (M4 hand-over slide)', () => {
  it('enters from the right and leaves to the left when moving forward', () => {
    expect(advanceVariants.hidden(1)).toEqual({ opacity: 0, x: DISTANCE.advance })
    expect(advanceVariants.exit(1)).toMatchObject({ opacity: 0, x: -DISTANCE.advance })
  })

  it('keeps the travel small enough not to read as a lurch on a phone', () => {
    expect(DISTANCE.advance).toBeLessThanOrEqual(24)
  })
})
