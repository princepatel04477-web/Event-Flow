/**
 * What the guest list shows while a search is working.
 *
 * The `/guests` screen (the legacy copy of the guest list) kept its
 * `searching` flag false forever: `setSearching(false)` ran, `setSearching(true)`
 * never did, so from the second search on the screen had no busy signal at all
 * while the PREVIOUS term's rows sat under a new term — a runner cannot tell
 * that from a search that never fired (`docs/BUGS.md` m12).
 *
 * The rule is the one `docs/INTERACTION-CONTRACT.md` T4 states, kept here as a
 * pure function so it has a test rather than living only in a component:
 *
 *   - nothing in flight            → `none`
 *   - in flight with nothing yet   → `skeleton` (a first search has no rows to
 *                                    keep, so a skeleton is honest)
 *   - in flight over older rows    → `stale` (keep them, and say they are old;
 *                                    replacing them with a skeleton is the
 *                                    "blinking" T4 forbids)
 */
export type SearchIndicator = 'none' | 'skeleton' | 'stale'

export function searchIndicator(pending: boolean, hasRows: boolean): SearchIndicator {
  if (!pending) return 'none'
  return hasRows ? 'stale' : 'skeleton'
}
