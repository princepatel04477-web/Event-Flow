/**
 * "Has the welcome already played during THIS app launch?"
 *
 * ── Why sessionStorage and not a module-level flag ─────────────────────────
 * A module flag resets on every full page load, and this app takes full page
 * loads it did not ask for. CLAUDE.md §12: firing a `tel:` backgrounds the
 * WebView and Android MAY discard page state — the same reason the call flow
 * keeps its attempt id in sessionStorage and rehydrates on resume. A caller
 * who dials twenty families would watch the welcome animation twenty times.
 *
 * sessionStorage has exactly the lifetime we mean by "one app launch": it
 * survives a reload inside the same WebView, and it is empty when Android
 * creates a new one. So:
 *
 *   client-side navigation      → component never remounts   → no replay
 *   return from the dialer      → reload, storage intact     → no replay
 *   Android killed the activity → new WebView, storage empty → plays (correct;
 *                                                              that IS a cold start)
 *
 * ── Why it fails closed ────────────────────────────────────────────────────
 * If sessionStorage throws — blocked storage, a WebView quirk, private mode —
 * we return false and skip the welcome. The alternative, failing open, would
 * replay the animation on every single navigation: the exact tax the 1.2s
 * ceiling exists to prevent. A missing flourish is invisible; a flourish that
 * fires on every screen is the thing staff complain about.
 */

const KEY = 'nuvent.welcome.played'

/**
 * Claims the one welcome slot for this app launch.
 *
 * Deliberately NOT a pure predicate — it marks the slot consumed as it reads,
 * in one synchronous step. A separate `check()` then `markPlayed()` would let
 * a remount (React StrictMode's double-invoke in dev, or a fast route change)
 * slip between the two and play twice. Call it once, keep the answer in state.
 *
 * @returns true exactly once per WebView session; false every time after.
 */
export function claimWelcome(): boolean {
  if (typeof window === 'undefined') return false

  try {
    if (window.sessionStorage.getItem(KEY) !== null) return false
    window.sessionStorage.setItem(KEY, '1')
    return true
  } catch {
    return false
  }
}

/**
 * Clears the claim so the next mount replays the welcome.
 *
 * For the /debug screen only — there is no product path that should reset
 * this. Without it, testing a change to the animation means force-stopping
 * the app between every attempt.
 */
export function resetWelcomeClaim(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    // Storage is blocked; claimWelcome() already fails closed. Nothing to do.
  }
}
