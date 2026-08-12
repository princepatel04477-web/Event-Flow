'use client'

import { decodeCodeAuthClaims } from '@/lib/auth/claims-client'
import type { CodeAuthClaims } from '@/lib/auth/claims-types'
import {
  clearClaims,
  persistClaims,
  readStoredClaims,
} from '@/lib/native/session-keeper'

/**
 * The code-auth session, read from durable client storage.
 *
 * M2 (bundled build) makes this the ONLY session authority. Previously the
 * httpOnly cookie was the authority and session-keeper held a "survival copy"
 * that SessionBridge used to rebuild the cookie after a WebView remount. With
 * no server there is no cookie to rebuild, so the survival copy is promoted to
 * the real thing — which is also what removes the remount bounce entirely
 * rather than papering over it.
 *
 * Storage is Capacitor Preferences on native (Android SharedPreferences, so it
 * outlives a WebView cache clear) and localStorage on web.
 */

/** Claims from storage, or null when there is no session. No network. */
export async function readSessionClaims(): Promise<CodeAuthClaims | null> {
  const stored = await readStoredClaims()
  if (!stored) return null

  const claims = decodeCodeAuthClaims(stored.token)
  if (!claims) return null

  // The staff pick is stored separately: the JWT is minted before the "Who are
  // you?" picker runs, so a token can predate the selection. Storage wins when
  // the token has no staff claim of its own.
  return {
    ...claims,
    staffMemberId: claims.staffMemberId ?? stored.staffMemberId ?? null,
  }
}

/** The raw token, for callers that need to send it themselves. */
export async function readSessionToken(): Promise<string | null> {
  const stored = await readStoredClaims()
  return stored?.token ?? null
}

/**
 * Liveness of the access code behind this session.
 *
 * This is also the app's only real signature check. `session_code_live` is an
 * RPC, so the call goes through PostgREST, which validates the JWT against the
 * project secret before the function body runs — a forged or tampered token
 * cannot get `true` out of this. That is what lets claims-client.ts decode
 * without verifying.
 *
 * Why it exists at all: signature and expiry are not enough. Confirmed on
 * 2026-08-09 against the live project, a session kept full read AND write
 * access after its code was revoked, because nothing on the request path read
 * the code row. `app.code_is_live()` (migration 20260809140000) is the real
 * enforcement and is folded into is_staff/is_member, so RLS refuses the data
 * regardless. This check exists so the APP agrees — otherwise a revoked phone
 * renders an empty shell, which at a venue reads as "the app is broken" rather
 * than "this phone was revoked".
 *
 * OFFLINE SEMANTICS — this is where the client deliberately differs from the
 * old server version (auth/server.ts), which failed closed on every error.
 * Failing closed on a network error is right for a server, which always has
 * connectivity; in a bundled app it would sign every handset out the moment
 * venue Wi-Fi dropped, which is the exact failure this whole conversion is
 * meant to survive. So:
 *
 *   - authoritative rejection (HTTP 401/403, or a plain `false`) → NOT live.
 *     The server was reached and said no.
 *   - unreachable server / timeout / offline → treated as live.
 *     Nothing is granted by this: every read and write still has to pass RLS
 *     when connectivity returns, and an offline handset has no way to reach
 *     the data at all. Keeping the session lets staff carry on working into
 *     the outbox instead of being locked out of a queue they are holding.
 */
export type LivenessResult = 'live' | 'revoked' | 'unreachable'

export async function checkSessionLiveness(token: string): Promise<LivenessResult> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  // A build with no Supabase config is broken, not revoked — do not sign
  // anyone out over it.
  if (!url || !key) return 'unreachable'

  let res: Response
  try {
    // Sends the session's own JWT: session_code_live() reads access_code_id
    // from the token, so no id is passed in. A plain select on
    // event_access_codes returns nothing for any session type (RLS), hence
    // the security-definer RPC.
    res = await fetch(`${url}/rest/v1/rpc/session_code_live`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
      cache: 'no-store',
    })
  } catch {
    // Network-level failure: DNS, no route, TLS, abort. The server was never
    // reached, so it has not rejected anything.
    return 'unreachable'
  }

  // 401/403 mean PostgREST itself refused the token — bad signature, expired,
  // or malformed. That is authoritative.
  if (res.status === 401 || res.status === 403) return 'revoked'

  // Any other non-OK status is a server-side problem (5xx, gateway, rate
  // limit), not a statement about this session.
  if (!res.ok) return 'unreachable'

  try {
    return (await res.json()) === true ? 'live' : 'revoked'
  } catch {
    return 'unreachable'
  }
}

/**
 * Persist a freshly minted session. Called after verify-access-code returns a
 * token, and after the staff picker resolves an identity.
 *
 * Replaces setCodeAuthSession/restoreCodeAuthSession from auth/session.ts,
 * which wrote httpOnly cookies and then `redirect()`ed. Navigation is the
 * caller's job now — a server action could redirect mid-request, a client
 * function should not decide where you land.
 */
export async function saveSession(params: {
  token: string
  staffMemberId?: string | null
  eventCode?: string | null
}): Promise<void> {
  await persistClaims({
    token: params.token,
    staffMemberId: params.staffMemberId ?? null,
    eventCode: params.eventCode ?? null,
  })
}

/** Sign out: drop the stored session. */
export async function clearSession(): Promise<void> {
  await clearClaims()
}
