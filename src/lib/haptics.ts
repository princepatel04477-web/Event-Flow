/**
 * A 12ms confirmation tick, via the WebView's vibration API (M5).
 *
 * Best-effort on purpose. A cheap Android handset may not report `vibrate`,
 * a WebView may gate it behind a user gesture, and nothing about a save
 * should fail because the handset could not buzz. So it never throws and
 * never reports: it fires when it can and is silent when it cannot.
 *
 * No Capacitor Haptics plugin here — that needs an APK rebuild, and the
 * whole point of a `navigator.vibrate` tick is that it ships with the web
 * bundle (CLAUDE.md §12: the APK is a remote shell over the deployed site).
 */
export function hapticTick(): void {
  if (typeof navigator === 'undefined') return
  try {
    if ('vibrate' in navigator) navigator.vibrate(12)
  } catch {
    // ignore — a missing permission or a dead bridge is not an error to show.
  }
}
