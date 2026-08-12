import 'server-only'

import { cookies } from 'next/headers'

import { verifyCodeAuthToken, type CodeAuthClaims } from '@/lib/auth/claims'
import { CODE_AUTH_COOKIE, STAFF_MEMBER_COOKIE } from '@/lib/auth/cookies'

/**
 * Read and verify the code-auth session from the httpOnly cookie.
 * Returns the claims, or null when there is no valid code-auth session.
 *
 * This is the server-side replacement for `auth.getUser()` in the
 * code-auth world: a code-auth JWT is not a GoTrue token, so it must be
 * verified here (signature + expiry) rather than via Supabase Auth.
 *
 * The staff-member selection lives in a separate cookie (the JWT is
 * already minted before the picker) and is merged into the claims.
 */
export async function getSessionClaims(): Promise<CodeAuthClaims | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(CODE_AUTH_COOKIE)?.value
  if (!token) return null
  const claims = await verifyCodeAuthToken(token)
  if (!claims) return null

  if (!(await isAccessCodeLive(token))) return null

  const staffMemberId =
    claims.staffMemberId ??
    cookieStore.get(STAFF_MEMBER_COOKIE)?.value ??
    null
  return { ...claims, staffMemberId }
}

/**
 * Has the access code behind this session been revoked or rotated?
 *
 * Signature and expiry alone are not enough. Confirmed on 2026-08-09
 * against the live project: a session kept full read AND write access to
 * guest data after its code was revoked, because nothing on the request
 * path ever looked at the code row — revoked_at was checked at mint time
 * inside the Edge Function and nowhere else. A lost phone stayed working
 * for the remainder of the token's life.
 *
 * app.code_is_live() (migration 20260809140000) is the real enforcement:
 * it is folded into is_staff/is_member, so RLS refuses the data even for
 * a direct PostgREST call that never touches Next.js. This check exists
 * so the APP agrees — without it a revoked session renders an empty
 * shell instead of being sent back to the login screen, which at a venue
 * looks like the app is broken rather than like the phone was revoked.
 *
 * Fails CLOSED: if the lookup errors, the session is treated as dead.
 */
async function isAccessCodeLive(token: string): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return false

  try {
    // Sends the session's own JWT: session_code_live() reads
    // access_code_id from the token, so no id is passed in. A plain
    // select on event_access_codes would return nothing for any session
    // type (RLS), hence the security-definer RPC.
    const res = await fetch(`${url}/rest/v1/rpc/session_code_live`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
      cache: 'no-store',
    })
    if (!res.ok) return false
    return (await res.json()) === true
  } catch {
    return false
  }
}
