/**
 * The sentence the review screen shows when a guest-count field is not a
 * whole number.
 *
 * `detectInvalidNumbers()` (in `./payload`) already carries the reason a
 * commit is blocked; the screen simply never rendered it, so the reviewer saw
 * "Every field decided", a disabled primary, and no explanation anywhere.
 *
 * The labels in `payload.ts` say "pax". Staff-facing copy must not: this is
 * the same rule that bans the word from every other screen, so the label is
 * translated here, once, where a test can pin it.
 */
export function invalidNumberMessage(label: string): string {
  const field = label.replace(/\bpax\b/gi, 'guests')
  return `${field} must be a whole number.`
}

export default invalidNumberMessage
