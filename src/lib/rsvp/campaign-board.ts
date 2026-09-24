/**
 * Which face the auto-call board shows.
 *
 * The bug: the guest-count read's `error` was dropped and `guestCount ?? 0`
 * became `0`, so a refused or failed read rendered "No families to call yet —
 * Import the guest list first." A load failure was reported to staff as a
 * fact about the event, and the action it invited (re-importing 238 families)
 * is exactly the wrong one.
 *
 * The second half of the same bug: `ensureCampaigns` ignored its insert
 * (and read) errors and returned `[]`, so the board rendered no round card at
 * all — no "Start calling", no message, no way to create rounds. An event with
 * families but no rounds is never a legitimate state: `ensureCampaigns`
 * creates the three rounds on first render, so zero rounds means the write or
 * the read behind it failed.
 *
 * Split out so the choice is pinned by a test: a failure never wins the
 * "empty event" branch, and a genuinely empty event keeps its own sentence.
 */
export type CampaignBoardFace = 'load-error' | 'no-families' | 'board'

export function campaignBoardFace(input: {
  loadError: string | null
  guestCount: number
  campaignCount: number
}): CampaignBoardFace {
  if (input.loadError) return 'load-error'
  if (input.guestCount <= 0) return 'no-families'
  if (input.campaignCount <= 0) return 'load-error'
  return 'board'
}

export default campaignBoardFace
