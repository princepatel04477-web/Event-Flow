'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'

import { restoreCodeAuthSession } from '@/lib/auth/session'
import { readStoredClaims } from '@/lib/native/session-keeper'
import { isNativePlatform } from '@/lib/native/platform'

/** The staff picker is deliberately mid-auth — never auto-restore there (a
 *  user must pick their identity). /login IS restored: a remount that lost
 *  the cookie bounces to /login?next=..., and the bridge restores the cookie
 *  there so the login page's own getSessionClaims() forwards back. A genuine
 *  login has no stored token, so the bridge no-ops. */
const NO_RESTORE_PATHS = ['/admin/login', '/pick-staff']

/** The marker that stops a double-restore inside one JS session. */
const RESTORED_KEY = 'nuvent_session_restored'

/**
 * Code-auth session survival across WebView remounts.
 *
 * Android will background and remount this WebView — every call, every camera
 * capture, every time it reclaims memory. A code-auth (team/client) session
 * is a JWT in an httpOnly cookie with no GoTrue refresh token behind it; when
 * the cookie is lost on remount, the staff guard bounces the user to /login.
 *
 * This bridge rehydrates the cookie from durable storage (Capacitor
 * Preferences) on cold mount AND on app resume, BEFORE a guard runs — the
 * staff layout redirects only when getSessionClaims() sees no cookie, so
 * restoring the cookie first is what stops the bounce. Guards are untouched.
 *
 * It does NOT run on the staff picker (the user must pick their identity)
 * and does NOT run on the web outside the remount case — a normal web reload
 * keeps the httpOnly cookie, so rehydrating would only fight the login flow.
 * It DOES run on /login: a remount that lost the cookie bounces there, and
 * restoring the cookie lets the login page forward back to `next`.
 *
 * ── TWO ONE-SHOT MECHANISMS, AND BOTH WERE BROKEN (M48) ────────────────────
 *
 * ONE. The effect was keyed on `[router, pathname]`, so EVERY client-side
 * navigation tore it down — and its cleanup removed the Capacitor
 * `appStateChange` listener. The body then early-returned on `hydratedRef`,
 * which is already true, so the listener was NEVER re-added. After one
 * navigation (queue → call screen, i.e. the first family called) the resume
 * path could not run again for the rest of the shift. It is now registered in
 * its own effect with an empty dependency array, so it lives as long as the
 * component does and nothing re-attaches it.
 *
 * TWO. The `sessionStorage` marker was SET on the first successful restore and
 * never CLEARED, so every later restore in that JS session returned early. The
 * marker exists for one reason — do not double-restore immediately after a
 * fresh code login — so it is now cleared as soon as a guard confirms the
 * cookie is gone (`clearSessionRestoredMarker`). A restore that succeeded and
 * then lost the cookie again is exactly the case the bridge exists for, and it
 * was the case the marker made impossible.
 */

/** Called by a guard that has just observed NO session, so the next restore runs. */
export function clearSessionRestoredMarker(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.removeItem(RESTORED_KEY)
  } catch {
    // Private mode. Nothing to clear, and the marker was never readable either.
  }
}

export function SessionBridge() {
  const router = useRouter()
  const pathname = usePathname()
  // Written in an effect, not during render: React forbids a ref write in the
  // render pass, and this ref exists only to let the one-shot listener see the
  // CURRENT path without being re-registered. The effect has no dependency array
  // so it runs after every render, which is exactly the freshness it needs.
  const pathRef = useRef(pathname)
  useEffect(() => {
    pathRef.current = pathname
  })

  /**
   * The listener effect: registered ONCE for the life of the component.
   *
   * `[]` is the whole fix. It has no cleanup that would strand it — the only
   * teardown is a real unmount.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!isNativePlatform()) return

    let removed = false
    let appHandle: { remove: () => void } | undefined

    const onResume = () => {
      void rehydrate(pathRef.current, router)
    }

    void (async () => {
      const { App } = await import('@capacitor/app')
      const handle = await App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) onResume()
      })
      // The mount can have been torn down while the dynamic import resolved;
      // registering into that would leak a listener nothing removes.
      if (removed) handle.remove()
      else appHandle = handle
    })()

    return () => {
      removed = true
      appHandle?.remove()
    }
  }, [router])

  /**
   * The cold-mount effect: restore before the first guard runs.
   *
   * Keyed on the router only. It does NOT depend on the pathname — this fires
   * once, and re-running it on a navigation is what used to consume the mount
   * without doing anything.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return
    void rehydrate(pathRef.current, router)
  }, [router])

  return null
}

/**
 * Restore the cookie if durable storage holds a token and this route allows it.
 *
 * Shared by the cold-mount and the resume paths so the two cannot drift — the
 * original had the mount path do the work and the resume path early-return.
 */
async function rehydrate(
  pathname: string,
  router: { refresh: () => void },
): Promise<void> {
  const stored = await readStoredClaims()
  if (!stored?.token) return
  if (NO_RESTORE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return
  // The double-restore guard for a FRESH code login only. Cleared by a guard
  // that has seen the cookie go missing (see `clearSessionRestoredMarker`).
  try {
    if (sessionStorage.getItem(RESTORED_KEY) === '1') return
  } catch {
    // Private mode: the marker cannot be read, so every remount restores.
    // That is the safe direction — restoring a cookie that is already there is
    // a no-op, and the alternative is not restoring one that is gone.
  }
  try {
    await restoreCodeAuthSession(stored.token, stored.staffMemberId)
    try {
      sessionStorage.setItem(RESTORED_KEY, '1')
    } catch {
      // See above.
    }
    router.refresh()
  } catch {
    // Restore failed (network/edge) — the guard will redirect and the
    // user signs in again; the persisted copy is still there for next time.
  }
}

export default SessionBridge
