import { describe, expect, it } from 'vitest'

import { searchIndicator } from '@/lib/guests/search-view'

/**
 * The `/guests` search's busy rule (`docs/BUGS.md` m12).
 *
 * The defect this pins was a flag that was only ever cleared: with nothing in
 * flight the screen looked identical to a search that never fired, while the
 * previous term's results stayed on screen under the new term.
 */
describe('searchIndicator', () => {
  it('says nothing when no search is in flight', () => {
    expect(searchIndicator(false, false)).toBe('none')
    expect(searchIndicator(false, true)).toBe('none')
  })

  it('shows a skeleton for a first search, which has no rows to keep', () => {
    expect(searchIndicator(true, false)).toBe('skeleton')
  })

  it('keeps the older rows and calls them stale, rather than blinking', () => {
    // T4: replacing previous results with a skeleton on every keystroke makes a
    // 300ms debounce feel like a stall.
    expect(searchIndicator(true, true)).toBe('stale')
  })
})
