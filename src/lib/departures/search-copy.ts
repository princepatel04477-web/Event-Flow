/**
 * The sentence the walk-up departure search shows when it finds nobody.
 *
 * The bug was worse than a missing message: a no-match result reset the
 * screen to an empty search box with no word about it, which looks identical
 * to a tap that never registered. This is the words that tell them apart, in
 * one place so the test can pin them.
 */
export function noMatchMessage(term: string): string {
  const cleaned = term.trim()
  const quoted = cleaned === '' ? 'that search' : `'${cleaned}'`
  return `No family matches ${quoted} — try part of the name, or the room number.`
}

export default noMatchMessage
