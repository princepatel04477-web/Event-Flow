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
 */
export function SessionBridge() {
  const router = useRouter()
  const pathname = usePathname()

  // `pathname` is read inside rehydrate() but must NOT be an effect dependency.
  // This effect owns a native listener whose lifetime has nothing to do with
  // navigation — see the note below.
  const pathnameRef = useRef(pathname)
  useEffect(() => {
    pathnameRef.current = pathname
  })

  useEffect(() => {
    if (typeof window === 'undefined') return

    const isNative = isNativePlatform()
    let appHandle: { remove: () => void } | undefined

    async function rehydrate() {
      const stored = await readStoredClaims()
      if (!stored?.token) return
      const path = pathnameRef.current
      if (NO_RESTORE_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) return
      try {
        // Idempotent by construction: restoreCodeAuthSession re-writes the SAME
        // cookie with the same token. So there is no marker to keep and no
        // "already restored" state to get stuck in.
        //
        // There used to be a sessionStorage marker here, set on the first
        // restore and never cleared. It made rehydration one-shot for the whole
        // JS session: a WebView that lost its cookie on the SECOND remount (the
        // normal case — every call, camera capture, memory reclaim) could no
        // longer be restored and bounced to /login mid-shift. A guard that
        // prevents the fix from running is worse than no marker.
        await restoreCodeAuthSession(stored.token, stored.staffMemberId)
        router.refresh()
      } catch {
        // Restore failed (network/edge) — the guard will redirect and the
        // user signs in again; the persisted copy is still there for next time.
      }
    }

    // Cold mount: the WebView just remounted from scratch (app killed and
    // relaunched, or a navigation unloaded it). Restore before guards run.
    void rehydrate()

    // Resume (native only): the app was backgrounded (dialer, camera, home)
    // and came back. Refresh the cookie in case the backgrounded WebView lost
    // it. On the web there is no app lifecycle to listen to.
    //
    // REGISTERED IN ITS OWN EFFECT, with `[]` deps — not beside the cold-mount
    // restore above. The two used to share one effect whose deps were
    // `[router, pathname]`, so every client-side navigation ran the cleanup and
    // called `appHandle.remove()`, and the `hydratedRef` guard then refused to
    // re-add it. After the first navigation the app had NO resume listener for
    // the rest of the session — the exact remount the bridge exists to survive.
    async function wireResume() {
      if (!isNative) return
      const { App } = await import('@capacitor/app')
      appHandle = await App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) void rehydrate()
      })
    }
    void wireResume()

    return () => {
      appHandle?.remove()
    }
  }, [router])

  return null
}

export default SessionBridge
