'use client'

import { capacitorStorageAdapter } from '@/lib/supabase/capacitor-storage'
import { codeTokenCache } from '@/lib/supabase/code-token-cache'

/**
 * Durable storage for the code-auth session (team/client) — and, since M2, the
 * ONLY session authority.
 *
 * A code-auth session is a JWT minted by verify-access-code. It used to live in
 * an httpOnly cookie, with this module holding a survival copy: when the
 * WebView remounted (a tel: dial, a camera capture, Android reclaiming memory)
 * the cookie could be gone, and with it the only thing the server guard read,
 * so staff were bounced to /login. SessionBridge existed to rebuild the cookie
 * from here before a guard ran.
 *
 * The bundled build has no server and therefore no cookie, so this store is
 * promoted from survival copy to authority. That deletes the remount bounce at
 * the root instead of racing to patch it — there is no longer a second copy to
 * fall out of sync with.
 *
 * Backing store: Capacitor Preferences → Android SharedPreferences on native
 * (survives a WebView cache clear), localStorage on web.
 *
 * Persisting a signed JWT client-side does not change the trust model. The
 * cookie always carried this same token, and acceptance was never the client's
 * call: the token is signed with the project JWT secret, so PostgREST validates
 * it on every REST/RPC call and app.code_is_live() gates revoked codes inside
 * is_staff/is_member. See claims-client.ts.
 */
export interface StoredCodeClaims {
  /** The code-auth JWT (same value as the nuvent_code_auth cookie). */
  token: string
  /** The selected staff member id (nuvent_staff_member cookie), if picked. */
  staffMemberId: string | null
  /** The event code, so a restored session can route back to the same event. */
  eventCode: string | null
}

const JWT_KEY = 'nuvent_code_jwt'
const STAFF_KEY = 'nuvent_staff_member'
const EVENT_KEY = 'nuvent_event_code'

/** Persist the code-auth claims. Idempotent; never throws. */
export async function persistClaims(claims: StoredCodeClaims): Promise<void> {
  // Keep the browser fetch wrapper's in-memory copy in sync so RLS calls
  // carry the claims immediately (the durable read is async).
  codeTokenCache.current = claims.token
  try {
    await capacitorStorageAdapter.setItem(JWT_KEY, claims.token)
    if (claims.staffMemberId) await capacitorStorageAdapter.setItem(STAFF_KEY, claims.staffMemberId)
    if (claims.eventCode) await capacitorStorageAdapter.setItem(EVENT_KEY, claims.eventCode)
  } catch {
    // A failed persist must not break the CURRENT session: codeTokenCache is
    // already set above, so this boot keeps working and RLS calls keep their
    // bearer. What is lost is survival across a remount or restart — the user
    // has to log in again. Since M2 there is no cookie standing behind this,
    // so a silent failure here is the difference between one re-login and a
    // working session; it must never also take down the live one.
  }
}

/** Read the stored code-auth claims, or null when none are stored. */
export async function readStoredClaims(): Promise<StoredCodeClaims | null> {
  try {
    const token = await capacitorStorageAdapter.getItem(JWT_KEY)
    if (!token) return null
    // Mirror into the cache so the browser fetch wrapper sees it even on a
    // cold read (e.g. SessionBridge rehydration before any login this boot).
    codeTokenCache.current = token
    const [staffMemberId, eventCode] = await Promise.all([
      capacitorStorageAdapter.getItem(STAFF_KEY),
      capacitorStorageAdapter.getItem(EVENT_KEY),
    ])
    return { token, staffMemberId, eventCode }
  } catch {
    return null
  }
}

/** Remove the stored code-auth claims (sign-out). */
export async function clearClaims(): Promise<void> {
  codeTokenCache.current = null
  try {
    await Promise.all([
      capacitorStorageAdapter.removeItem(JWT_KEY),
      capacitorStorageAdapter.removeItem(STAFF_KEY),
      capacitorStorageAdapter.removeItem(EVENT_KEY),
    ])
  } catch {
    // codeTokenCache is cleared above, so the live session is already dead for
    // this boot. A failed durable clear means the token could come back on the
    // next cold start, which is a real sign-out failure now that no cookie
    // clear stands behind it — but there is nothing sane to retry with here.
    // The backstop is server-side: revoking the code kills the session via
    // app.code_is_live() no matter what this device kept.
  }
}
