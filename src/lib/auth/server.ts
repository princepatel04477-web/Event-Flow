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

  const staffMemberId = cookieStore.get(STAFF_MEMBER_COOKIE)?.value ?? null
  return { ...claims, staffMemberId }
}
