'use client'

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'

import {
  checkSessionLiveness,
  readSessionClaims,
  readSessionToken,
  type LivenessResult,
} from '@/lib/auth/session-client'
import type { CodeAuthClaims } from '@/lib/auth/claims-types'
import { getViewerClient, invalidateClientQueries } from '@/lib/supabase/queries-client'
import type { Viewer } from '@/lib/supabase/queries-types'

/**
 * The session, resolved once for the whole app.
 *
 * Replaces three server-side mechanisms that the bundled build cannot have:
 *
 *  1. `proxy.ts` / `updateSession()` — the middleware that refreshed the
 *     session cookie on every request and bounced anonymous users to /login.
 *     There is no request layer in a static export, so the bounce moves here.
 *  2. `getSessionClaims()` (28 call sites) — read the httpOnly cookie and
 *     verify it server-side. Now: read durable storage and decode.
 *  3. `getViewer()` (19 call sites) — resolved per request, memoised per
 *     request. Now: resolved once per mount, held in context.
 *
 * Resolving once and sharing is not just an optimisation. The server versions
 * re-resolved in the layout AND again in each page because a server layout
 * cannot see the pathname; a client provider has no such limitation, so the
 * duplicate read disappears rather than being cached around.
 */

/** Where the session resolution has got to. Rendered states, not internals. */
export type SessionStatus =
  /** Still reading storage / resolving the viewer. Render nothing decisive. */
  | 'loading'
  /** A live session. `viewer` is non-null. */
  | 'authenticated'
  /** No session, or an authoritatively dead one. The gate redirects. */
  | 'anonymous'

export type SessionValue = {
  status: SessionStatus
  viewer: Viewer | null
  claims: CodeAuthClaims | null
  /**
   * True when the last liveness check could not reach the server.
   *
   * Deliberately surfaced rather than swallowed: the session is being trusted
   * on the device's word, and the screens that queue writes to the outbox need
   * to say so. See checkSessionLiveness for why an unreachable server does not
   * end the session.
   */
  offline: boolean
  /** Re-resolve from scratch. Call after login, logout, or a staff pick. */
  refresh: () => Promise<void>
}

const SessionContext = createContext<SessionValue | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading')
  const [viewer, setViewer] = useState<Viewer | null>(null)
  const [claims, setClaims] = useState<CodeAuthClaims | null>(null)
  const [offline, setOffline] = useState(false)

  // Takes a cancellation probe rather than checking a ref: this runs on mount
  // (where unmount must abandon the result) and from refresh() (where it must
  // not). One function, two lifetimes, decided by the caller.
  const resolve = useCallback(async (isCancelled: () => boolean) => {
    const token = await readSessionToken()
    if (isCancelled()) return

    // No stored code-auth token does NOT mean anonymous: an admin signs in
    // through GoTrue and has no code token at all. Fall through to the viewer
    // read, which handles both session kinds.
    let liveness: LivenessResult = 'live'
    if (token) {
      liveness = await checkSessionLiveness(token)
      setOffline(liveness === 'unreachable')

      // Only an authoritative rejection ends the session. 'unreachable' keeps
      // it — an offline handset cannot reach the data anyway, and signing staff
      // out mid-event because venue Wi-Fi dropped is the failure this whole
      // conversion exists to prevent.
      if (liveness === 'revoked') {
        invalidateClientQueries()
        setViewer(null)
        setClaims(null)
        setStatus('anonymous')
        return
      }
    } else {
      setOffline(false)
    }

    const [nextClaims, nextViewer] = await Promise.all([readSessionClaims(), getViewerClient()])
    if (isCancelled()) return

    setClaims(nextClaims)
    setViewer(nextViewer)
    // A code-auth session whose event row could not be read returns a null
    // viewer from getViewerClient(). Offline that is a network failure, not a
    // sign-out, so the claims alone are enough to stay authenticated.
    const authenticated = nextViewer !== null || (nextClaims !== null && liveness === 'unreachable')
    setStatus(authenticated ? 'authenticated' : 'anonymous')
  }, [])

  const refresh = useCallback(async () => {
    invalidateClientQueries()
    setStatus('loading')
    // Never cancelled: an explicit refresh (login, logout, staff pick) must
    // land, and its caller is still mounted by definition.
    await resolve(() => false)
  }, [resolve])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await resolve(() => cancelled)
    })()
    return () => {
      cancelled = true
    }
  }, [resolve])

  return (
    <SessionContext.Provider value={{ status, viewer, claims, offline, refresh }}>
      {children}
    </SessionContext.Provider>
  )
}

/** The session. Throws if used outside the provider — a wiring bug, not a state. */
export function useSession(): SessionValue {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useSession must be used inside <SessionProvider>')
  return value
}

/** The viewer, or null while loading / anonymous. A convenience for rendering. */
export function useViewer(): Viewer | null {
  return useSession().viewer
}

/**
 * Client replacement for the middleware's anonymous bounce.
 *
 * Returns the session once authenticated, and redirects to /login otherwise.
 * Callers must handle `status === 'loading'` by rendering a skeleton — there is
 * no server render to hide it behind any more, so a screen that renders its
 * empty state during loading will flash "0 families" before the data lands.
 */
export function useRequireSession(): SessionValue {
  const session = useSession()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (session.status !== 'anonymous') return
    // `replace`, not `push`: a bounced-to login must not leave the guarded
    // screen in the back stack, or Android's back button walks straight into
    // it again and bounces in a loop.
    router.replace(`/login?next=${encodeURIComponent(pathname)}`)
  }, [session.status, router, pathname])

  return session
}
