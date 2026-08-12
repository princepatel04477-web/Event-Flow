import { jwtVerify } from 'jose'

import type { CodeAuthClaims } from '@/lib/auth/claims-types'

/**
 * Code-auth session claims — the verified contents of the JWT minted by
 * the verify-access-code Edge Function.
 *
 * A code-auth session is NOT a GoTrue session: there is no auth.users
 * row, no refresh token, no GoTrue-issued JWT. The identity is entirely
 * in these claims, and RLS reads the same claims via auth.jwt(). This
 * helper is the server-side counterpart: it verifies the token's
 * signature against the project JWT secret (the same secret the Edge
 * Function signs with and PostgREST validates against) and returns the
 * claims the app needs to route and render.
 *
 * M2 NOTE: this file only runs while Next.js is still on the request path.
 * The bundled build has no server and cannot hold the secret, so the client
 * reads claims via decodeCodeAuthClaims() in claims-client.ts and treats
 * PostgREST as the verifier. Delete this file once no server guard remains.
 *
 * `CodeAuthClaims` now lives in claims-types.ts so client code can import the
 * type without pulling 'server-only' in behind it. Re-exported here so the
 * existing `from '@/lib/auth/claims'` imports keep resolving.
 */
export type { CodeAuthClaims }

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET ?? process.env.APP_JWT_SECRET ?? '')

/**
 * Verify a code-auth JWT and return its claims, or null if it is
 * missing, malformed, or fails signature/expiry verification. This is
 * the ONLY way the server accepts a code-auth session — a token that
 * does not verify is treated as not signed in.
 */
export async function verifyCodeAuthToken(token: string | undefined | null): Promise<CodeAuthClaims | null> {
  if (!token || !SECRET.length) return null

  try {
    const { payload } = await jwtVerify(token, SECRET, {
      algorithms: ['HS256'],
    })

    const appRole = payload.app_role
    const eventId = payload.event_id
    const accessCodeId = payload.access_code_id
    const staffMemberId = payload.staff_member_id ?? null

    if (appRole !== 'team' && appRole !== 'client') return null
    if (typeof eventId !== 'string' || !eventId) return null
    if (typeof accessCodeId !== 'string' || !accessCodeId) return null

    return {
      appRole,
      eventId,
      accessCodeId,
      staffMemberId: typeof staffMemberId === 'string' ? staffMemberId : null,
    }
  } catch {
    // Signature invalid, expired, or malformed — treat as not signed in.
    return null
  }
}
