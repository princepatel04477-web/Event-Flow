import { describe, expect, it } from 'vitest'

import { initials, progressCount, progressPercent } from '@/lib/ui/metrics'

describe('progressPercent', () => {
  it('rounds to a whole percent', () => {
    expect(progressPercent(38, 171)).toBe(22)
    expect(progressPercent(1, 3)).toBe(33)
    expect(progressPercent(2, 3)).toBe(67)
  })

  it('is 0 when nothing is done and 100 when it is all done', () => {
    expect(progressPercent(0, 74)).toBe(0)
    expect(progressPercent(74, 74)).toBe(100)
  })

  it('is 0 when there is nothing to do, not NaN and not 100', () => {
    // "No rooms on this event yet" must render an EMPTY bar. A 0/0 that
    // returned 100 would tell a runner the work was finished.
    expect(progressPercent(0, 0)).toBe(0)
    expect(progressPercent(3, 0)).toBe(0)
    expect(Number.isNaN(progressPercent(0, 0))).toBe(false)
  })

  it('never exceeds 100 when the count has drifted past the total', () => {
    // A real state: a room re-count, or `confirmed_pax` outrunning the
    // invite. An over-wide bar pushes the row's right column off 360px.
    expect(progressPercent(80, 74)).toBe(100)
    expect(progressPercent(500, 3)).toBe(100)
  })

  it('never goes below 0', () => {
    expect(progressPercent(-5, 10)).toBe(0)
  })

  it('survives a non-finite input rather than producing NaN%', () => {
    expect(progressPercent(Number.NaN, 10)).toBe(0)
    expect(progressPercent(1, Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('always returns an integer a CSS width can take', () => {
    for (const [done, total] of [
      [1, 7],
      [13, 238],
      [465, 465],
      [99, 100],
    ]) {
      expect(Number.isInteger(progressPercent(done, total))).toBe(true)
    }
  })
})

describe('progressCount', () => {
  it('renders done over total with no separator', () => {
    expect(progressCount(38, 171)).toBe('38/171')
    expect(progressCount(0, 0)).toBe('0/0')
  })
})

describe('initials', () => {
  it('takes the first character of the first two words', () => {
    expect(initials('Ravi Kumar Sharma')).toBe('RK')
    expect(initials('Sharma Ravi')).toBe('SR')
  })

  it('takes two words whatever the order, so "Ravi S Sharma" is not "RS"', () => {
    // Indian family names arrive from the Excel sheet in every order; a
    // first-and-last rule would agree with this one here and disagree on
    // "Sharma Ravi", which is worse than being consistently first-two.
    expect(initials('Ravi S Sharma')).toBe('RS')
  })

  it('handles a single word', () => {
    expect(initials('Ravi')).toBe('R')
  })

  it('collapses odd whitespace', () => {
    expect(initials('  Ravi   Kumar  ')).toBe('RK')
    expect(initials('\tRavi\nKumar')).toBe('RK')
  })

  it('returns an empty string for a name with no usable characters', () => {
    expect(initials('')).toBe('')
    expect(initials('   ')).toBe('')
    expect(initials(null)).toBe('')
    expect(initials(undefined)).toBe('')
  })

  it('uppercases Latin and leaves a caseless script alone', () => {
    expect(initials('ravi kumar')).toBe('RK')
    // Devanagari has no case: toUpperCase is a no-op, and the avatar still
    // gets a real letter rather than a replacement box.
    expect(initials('शर्मा परिवार')).toBe('शप')
  })

  it('takes one character, not half a surrogate pair', () => {
    // A name starting with an astral character must not render half of one.
    expect(Array.from(initials('𝄞 Ravi')).length).toBe(2)
  })

  it('never returns more than two characters', () => {
    for (const name of ['A B C D', 'Ravi Kumar Sharma', 'शर्मा परिवार जी']) {
      expect(Array.from(initials(name)).length).toBeLessThanOrEqual(2)
    }
  })
})
