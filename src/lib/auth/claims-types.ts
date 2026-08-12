/**
 * The shape of a code-auth session's claims.
 *
 * Split out of claims.ts so both sides can import it. claims.ts carries
 * `import 'server-only'` (it holds the JWT secret), which makes it unusable
 * from a client component — but the type it defined was needed on both sides.
 * Types only in here: nothing importable from this file can leak a secret.
 *
 * A code-auth session is NOT a GoTrue session: there is no auth.users row, no
 * refresh token, no GoTrue-issued JWT. The identity is entirely in these
 * claims. RLS reads the same claims via auth.jwt(), and the token is signed
 * with the project JWT secret — the same secret the verify-access-code Edge
 * Function signs with and PostgREST validates against. That last part is why
 * the client is allowed to read these claims without verifying them; see
 * claims-client.ts.
 */
export interface CodeAuthClaims {
  /** 'team' | 'client' — from the app_role claim. */
  appRole: 'team' | 'client'
  /** The event this session may access. */
  eventId: string
  /** The access code row that minted this session. */
  accessCodeId: string
  /** The selected staff member, set after the "Who are you?" picker. */
  staffMemberId: string | null
}
