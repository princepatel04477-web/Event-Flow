'use client'

import { capacitorStorageAdapter } from '@/lib/supabase/capacitor-storage'
import { codeTokenCache } from '@/lib/supabase/code-token-cache'

/**
 * Durable storage for the code-auth session (team/client).
 *
 * A code-auth session is a JWT minted by verify-access-code, persisted in an
 * httpOnly cookie. When the WebView remounts — a tel: dial, a camera capture,
 * Android reclaiming memory — the cookie can be gone, and with it the only
 * thing the server guard reads. Nothing then rehydrates it, so staff are
 * bounced to /login.
 *
 * This module keeps the claims in a durable store (Capacitor Preferences →
 * Android SharedPreferences on native, localStorage on web for the e2e
 * remount simulation) and lets the SessionBridge restore the cookie before a
 * guard runs. Persisting a signed JWT client-side does not change the trust
 * model: the cookie already carried the same token, and the server's
 * verifyCodeAuthToken() remains the only acceptance path.
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
    // A failed persist must not break the current session — the cookie is
    // still the authority; this is only the survival copy.
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
    // Nothing sane to do on failure — the cookie clear is the real sign-out.
  }
}
