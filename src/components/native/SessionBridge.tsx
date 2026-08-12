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
  const hydratedRef = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const isNative = isNativePlatform()
    let appHandle: { remove: () => void } | undefined

    async function rehydrate() {
      const stored = await readStoredClaims()
      if (!stored?.token) return
      if (NO_RESTORE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return
      // A sessionStorage marker set right after a fresh code login tells us
      // the cookie was just written by the normal flow — do not double-restore.
      // (httpOnly cookies are not visible to document.cookie, so that check
      // cannot be used for idempotency.)
      if (sessionStorage.getItem('nuvent_session_restored') === '1') return
      try {
        await restoreCodeAuthSession(stored.token, stored.staffMemberId)
        sessionStorage.setItem('nuvent_session_restored', '1')
        router.refresh()
      } catch {
        // Restore failed (network/edge) — the guard will redirect and the
        // user signs in again; the persisted copy is still there for next time.
      }
    }

    async function init() {
      // Cold mount: the WebView just remounted from scratch (app killed and
      // relaunched, or a navigation unloaded it). Restore before guards run.
      await rehydrate()

      // Resume (native only): the app was backgrounded (dialer, camera, home)
      // and came back. Refresh the cookie in case the backgrounded WebView
      // lost it. On the web there is no app lifecycle to listen to.
      if (isNative) {
        const { App } = await import('@capacitor/app')
        appHandle = await App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) void rehydrate()
        })
      }
    }

    if (!hydratedRef.current) {
      hydratedRef.current = true
      void init()
    }

    return () => {
      appHandle?.remove()
    }
  }, [router, pathname])

  return null
}

export default SessionBridge
