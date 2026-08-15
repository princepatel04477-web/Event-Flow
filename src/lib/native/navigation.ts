'use client'

/**
 * Hand links that belong to the OS (tel:, mailto:) to the SYSTEM, never the
 * WebView.
 *
 * The Tier-0 bug this exists for: inside a Capacitor WebView, a plain
 * `<a href="tel:...">` (or `window.location.href = 'tel:...'`) can navigate
 * the WebView itself. The app unloads, and on return remounts from scratch —
 * which, with a cookie-only code-auth session, lands the caller on /login.
 *
 * Two layers:
 *   1. `openExternalUrl` — the primitive the call screen uses instead of
 *      `window.location.href`. Under Capacitor it opens the URL with the
 *      native App plugin (Android hands `tel:` to the dialer and keeps the
 *      WebView alive); on the web it falls back to `location.assign`.
 *   2. `wireExternalLinkInterception` — a document-level capturing click
 *      listener so ANY `tel:`/`mailto:` anchor in the app goes through the
 *      same system handoff and is never followed by the WebView. Idempotent.
 *
 * Test seam: when `(window as any).__NUVENT_OPEN_EXTERNAL__` is set (by an
 * e2e harness), the interceptor calls it instead of the native open. The
 * acceptance test asserts the call control hands the dial to this seam and
 * the page never navigates.
 */

import { isNativePlatform } from './platform'

/** The test-seam window shape (set by the e2e harness). */
interface NuvWindow extends Window {
  __NUVENT_OPEN_EXTERNAL__?: (url: string) => void
}

/** Open a tel:/mailto: URL in the system, never the WebView. */
export async function openExternalUrl(url: string): Promise<void> {
  if (typeof window === 'undefined') return

  const seam = (window as NuvWindow).__NUVENT_OPEN_EXTERNAL__
  if (typeof seam === 'function') {
    void seam(url)
    return
  }

  // This used to be `window.open(url, '_system')`, and that is why the dial
  // button did nothing.
  //
  // Two separate faults:
  //  1. `_system` is a CORDOVA target. Capacitor 8 does not implement it, so
  //     the second argument was just a window name.
  //  2. The call screen fires this AFTER `await startCallAttempt(...)`. That
  //     round-trip consumes the transient user activation, so the browser
  //     treats the `window.open` as an unsolicited popup and BLOCKS it. A
  //     blocked popup returns null — it does not throw — so the `catch`
  //     fallback below never ran. The tap silently did nothing.
  //
  // AppLauncher is the Capacitor-native equivalent: Android resolves the
  // tel: intent and opens the dialer without touching the WebView, so the
  // cookie session survives. On the web it is unavailable, and a plain
  // location assignment is correct — a navigation is not a popup, so it is
  // allowed without user activation, and the browser hands tel: to the OS.
  if (isNativePlatform()) {
    try {
      const { AppLauncher } = await import('@capacitor/app-launcher')
      await AppLauncher.openUrl({ url })
      return
    } catch {
      // Plugin missing or the intent could not be resolved — fall through
      // rather than leaving the caller with no dialer at all.
    }
  }

  window.location.href = url
}

/** True when a URL is a system scheme the WebView must never load itself. */
export function isSystemScheme(url: string): boolean {
  return /^(tel|mailto):/i.test(url)
}

/**
 * Open an `https:` URL that belongs to ANOTHER APP — a `wa.me` chat, a maps
 * link. Never in the WebView.
 *
 * `openExternalUrl` above is right for `tel:`/`mailto:`, where a plain
 * `location.href` hands the URL straight to the OS. An `https:` URL is a
 * different problem in both environments:
 *
 *  - Inside Capacitor, `location.href = 'https://wa.me/…'` NAVIGATES THE
 *    WEBVIEW. The app unloads, and the remount puts a cookie-only code-auth
 *    session back on /login — the same Tier-0 failure this module was
 *    written for. `isSystemScheme` does not match https, so the document
 *    interceptor never sees these links; they must be handled at the call
 *    site.
 *  - On the web, a same-tab navigation loses the screen the user was on,
 *    which on venue Wi-Fi means a full reload to get back. A new tab keeps it.
 *
 * Call this synchronously from the click handler. `window.open` needs the
 * transient user activation, so awaiting anything first gets it blocked —
 * and a blocked popup returns null rather than throwing.
 */
export function openExternalAppUrl(url: string): void {
  if (typeof window === 'undefined') return

  const seam = (window as NuvWindow).__NUVENT_OPEN_EXTERNAL__
  if (typeof seam === 'function') {
    void seam(url)
    return
  }

  if (isNativePlatform()) {
    // AppLauncher resolves the intent (WhatsApp, Maps) without touching the
    // WebView. Its own fallback is location.href, which is only reached when
    // the plugin is missing entirely.
    void openExternalUrl(url)
    return
  }

  window.open(url, '_blank', 'noopener,noreferrer')
}

let wired = false

/**
 * Intercept every tel:/mailto: anchor click at the document level, hand the
 * URL to the system (or the test seam), and prevent the WebView from ever
 * navigating. Safe to call repeatedly — wired once.
 */
export function wireExternalLinkInterception(): void {
  if (typeof window === 'undefined' || wired) return
  wired = true

  document.addEventListener(
    'click',
    (event) => {
      const anchor = (event.target as Element | null)?.closest?.('a[href]') as
        | HTMLAnchorElement
        | null
      if (!anchor) return

      const href = anchor.getAttribute('href') ?? ''
      if (!isSystemScheme(href)) return

      event.preventDefault()
      event.stopPropagation()

      const seam = (window as NuvWindow).__NUVENT_OPEN_EXTERNAL__
      if (typeof seam === 'function') {
        void seam(href)
      } else {
        void openExternalUrl(href)
      }
    },
    true,
  )
}
