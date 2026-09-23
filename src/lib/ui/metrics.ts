/**
 * Pure view helpers for the v3 component set (`src/components/ui/`).
 *
 * These are deliberately NOT React: every one of them answers a question a
 * screen asks in passing — "what percentage is 38 of 171", "what two letters
 * go in this avatar" — and keeping them here means they can be asserted in
 * vitest without a renderer, and reused by a screen that wants the same
 * answer in its own markup.
 *
 * Browser-safe and dependency-free. No `server-only`, no Supabase, no
 * `next/*`.
 */

/**
 * `done / total` as a whole-number percentage, clamped to 0…100.
 *
 * Clamped at the top because a denominator that has drifted below its
 * numerator is a real state in this app — a room re-count, a group whose
 * `confirmed_pax` outran its invite — and a bar wider than its track
 * silently pushes the row's right column off a 360px screen. Clamped at the
 * bottom for the mirror case.
 *
 * A total of 0 returns 0, not `NaN` and not 100: "nothing to do yet" must
 * render as an empty bar, never as a full one.
 *
 * Rounded to an integer because the ONLY consumer is a CSS width and a
 * label; a fractional percent buys nothing and jitters the string.
 */
export function progressPercent(done: number, total: number): number {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return 0
  const pct = (done / total) * 100
  if (pct <= 0) return 0
  if (pct >= 100) return 100
  return Math.round(pct)
}

/**
 * One or two letters for a 40px initials avatar.
 *
 * The first character of the first two words: "Ravi Kumar Sharma" → "RK".
 * Two words rather than first-and-last because Indian family names arrive
 * from the Excel sheet in every order ("Sharma Ravi", "Ravi S Sharma") and
 * first-and-last on the ragged ones picks up an initial nobody uses.
 *
 * Returns `''` for an empty or whitespace-only name — the caller renders its
 * own fallback (a room number, a glyph) rather than a stray "?".
 *
 * Devanagari names pass through unchanged: `toUpperCase` is a no-op on a
 * script with no case, and `Array.from` takes the first character rather
 * than the first UTF-16 code unit, so a name starting with an astral
 * character (an emoji, a rare ligature) yields one character and not half
 * of a surrogate pair.
 */
export function initials(name: string | null | undefined): string {
  if (!name) return ''
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''
  return words
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toUpperCase()
}

/**
 * `done / total` as the right-hand figure on a `Progress` or `BottomBar`
 * summary line — "38/171".
 *
 * No thousands separator: these numbers are one or two digits in every real
 * case (238 families, 465 guests), and a comma in "1,024/1,200" costs a
 * character of a 64px column to say nothing.
 */
export function progressCount(done: number, total: number): string {
  return `${done}/${total}`
}
