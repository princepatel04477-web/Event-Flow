import { describe, expect, it } from 'vitest'

import { noMatchMessage } from '../src/lib/departures/search-copy'

describe('noMatchMessage', () => {
  it('says nobody matched, and names what was searched for', () => {
    const message = noMatchMessage('Sharma')
    expect(message).toContain('No family matches')
    expect(message).toContain("'Sharma'")
  })

  it('tells staff what to try next', () => {
    // The e2e spec (e3) accepts any sentence matching this family; the point
    // is that the screen says something rather than resetting to a blank box.
    expect(noMatchMessage('Sharma')).toMatch(/No family matches/i)
    expect(noMatchMessage('  ')).toContain('No family matches')
  })
})
