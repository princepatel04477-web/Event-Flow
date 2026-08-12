import type { CodeAuthClaims } from '@/lib/auth/claims-types'

/**
 * Client-side reader for code-auth session claims.
 *
 * THIS DOES NOT VERIFY THE SIGNATURE, AND MUST NOT TRY.
 *
 * The bundled app (M2, `output: 'export'`) has no server, so there is nowhere
 * to hold APP_JWT_SECRET — shipping it inside the APK would publish it, since
 * an APK is a zip file anyone can read the strings out of. The old
 * `verifyCodeAuthToken()` existed because Next.js was on the request path and
 * could hold the secret; nothing on the device can.
 *
 * That is not a downgrade, because the client was never the trust boundary:
 *
 *  - The token is signed with the PROJECT JWT secret, which is exactly what
 *    PostgREST validates on every REST/RPC call (see the note in
 *    claims-types.ts). A forged or tampered token is rejected by PostgREST
 *    before RLS is even consulted.
 *  - `app.code_is_live()` is folded into `app.is_staff()` / `app.is_member()`
 *    (migration 20260809140000), so a revoked or rotated code gets zero rows
 *    even on a direct PostgREST call that never touches app code.
 *
 * So the worst a doctored token achieves is rendering a shell that returns no
 * data. These claims decide which screen to draw and whose name to show —
 * never whether data may be read. For the "is this session actually alive"
 * question, use `sessionIsLive()` in session-client.ts, which round-trips
 * through PostgREST and therefore IS a signature check.
 */

/** Decode one base64url segment of a JWT into a UTF-8 string. */
function decodeSegment(segment: string): string {
  // JWT uses base64url; atob needs standard base64 with padding.
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  const binary = atob(padded)
  // The payload contains staff names, which are routinely non-ASCII
  // (Gujarati/Hindi). A plain atob() would mangle them, so decode the bytes
  // as UTF-8 rather than trusting atob's latin1 output.
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/**
 * Read the claims out of a code-auth JWT without verifying it.
 *
 * Returns null for a token that is missing, malformed, expired, or shaped
 * wrong. Expiry IS checked here — not as a security measure (the server
 * checks it too) but so an obviously dead session sends staff to the login
 * screen instead of into an app that silently returns nothing.
 */
export function decodeCodeAuthClaims(token: string | undefined | null): CodeAuthClaims | null {
  if (!token) return null

  const parts = token.split('.')
  if (parts.length !== 3) return null

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(decodeSegment(parts[1])) as Record<string, unknown>
  } catch {
    return null
  }

  const appRole = payload.app_role
  const eventId = payload.event_id
  const accessCodeId = payload.access_code_id
  const staffMemberId = payload.staff_member_id ?? null
  const exp = payload.exp

  if (appRole !== 'team' && appRole !== 'client') return null
  if (typeof eventId !== 'string' || !eventId) return null
  if (typeof accessCodeId !== 'string' || !accessCodeId) return null

  // `exp` is seconds since epoch, per JWT. Treat a token with no exp as dead:
  // every token this app issues has one, so its absence means the payload is
  // not one of ours.
  if (typeof exp !== 'number' || exp * 1000 <= Date.now()) return null

  return {
    appRole,
    eventId,
    accessCodeId,
    staffMemberId: typeof staffMemberId === 'string' ? staffMemberId : null,
  }
}
