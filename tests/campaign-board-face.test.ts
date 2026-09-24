import { describe, expect, it } from 'vitest'

import { campaignBoardFace } from '../src/lib/rsvp/campaign-board'

describe('campaignBoardFace', () => {
  it('shows the load failure, not "import the guest list", when the read failed', () => {
    // This is the bug: a refused read became guestCount 0 and the board told
    // staff to import a guest list that already exists.
    expect(
      campaignBoardFace({
        loadError: 'Could not load the calling board.',
        guestCount: 0,
        campaignCount: 0,
      }),
    ).toBe('load-error')
  })

  it('keeps the empty-event sentence for a genuinely empty event', () => {
    expect(campaignBoardFace({ loadError: null, guestCount: 0, campaignCount: 0 })).toBe('no-families')
  })

  it('shows the board when families and rounds exist', () => {
    expect(campaignBoardFace({ loadError: null, guestCount: 238, campaignCount: 3 })).toBe('board')
    expect(campaignBoardFace({ loadError: null, guestCount: 1, campaignCount: 1 })).toBe('board')
  })

  it('treats families with no rounds as a failure, never as a blank board', () => {
    // The other half of the bug: the rounds insert/read failed and the screen
    // rendered no round card and no message.
    expect(campaignBoardFace({ loadError: null, guestCount: 238, campaignCount: 0 })).toBe('load-error')
  })
})
