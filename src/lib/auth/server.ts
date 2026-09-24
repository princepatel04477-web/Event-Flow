import 'server-only'

import { cookies } from 'next/headers'

import { verifyCodeAuthToken, type CodeAuthClaims } from '@/lib/auth/claims'
import { CODE_AUTH_COOKIE, STAFF_MEMBER_COOKIE } from '@/lib/auth/cookies'
import { perRequest } from '@/lib/request-cache'
import { fingerprint, ttlCache } from '@/lib/ttl-cache'

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
 *
 * ── WHY THIS IS MEMOISED PER REQUEST, AND WHAT IT COST BEFORE ───────────────
 *
 * ONE staff navigation called this FOUR times: the v2 layout calls it directly
 * and again through `getViewer()`, a third time inside `getEventAccess()`, and a
 * fourth inside `getStaffViewerContext()`. Each call verified the JWT (cheap,
 * local, HMAC) and then asked the database whether the access code behind it was
 * still live — a round trip to Seoul, 200-500 ms measured from India. So the
 * guard work alone could put four sequential trips in front of a screen that
 * renders in one.
 *
 * It is now resolved once per request, with the negative answer cached too.
 * `perRequest` deliberately refuses to cache nullish values, because for most
 * callers a null means "no answer yet" and caching it turned a transient miss
 * into a sticky one: see the header of `src/lib/request-cache.ts`. Here a null is
 * a real, final answer ABOUT THIS REQUEST — "this request carries no code
 * session" — and request scope cannot leak it into another session, which was the
 * failure mode that rule exists to prevent. A sentinel is used rather than
 * loosening `perRequest`, so every other caller keeps the stricter contract.
 */
const ABSENT = Symbol('no-code-auth-session')

export async function getSessionClaims(): Promise<CodeAuthClaims | null> {
  const resolved = await perRequest('auth:code-claims', async () => {
    const claims = await readSessionClaims()
    return claims ?? ABSENT
  })
  return resolved === ABSENT ? null : resolved
}

/** The uncached read: verify the cookie, then prove the code is still live. */
async function readSessionClaims(): Promise<CodeAuthClaims | null> {
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
 * How long a CONFIRMED-LIVE answer to `session_code_live()` is trusted.
 *
 * REVOCATION STILL ENDS DATA ACCESS IMMEDIATELY. The real fence is
 * `app.code_is_live()`, folded into `app.is_staff()` / `app.is_member()` by
 * migration `20260809140000`, and it is evaluated by PostgREST on EVERY request
 * that reads or writes a row. Nothing here weakens that: a revoked phone is
 * handed zero rows on its very next query, cache or no cache.
 *
 * What this TTL bounds is the APP-LAYER courtesy described below: how long a
 * revoked session can keep rendering an empty shell before the app agrees with
 * the database and sends it back to /login. At 60 s the worst case is a minute
 * on a screen with nothing on it — against a round trip to Seoul in front of
 * every screen for every caller, on every navigation, all day.
 *
 * Only a `true` is cached. A `false` is re-asked every time, so the moment a code
 * is revoked the app notices on the next request that reaches this function
 * rather than up to a minute later; the TTL only ever delays re-confirming a code
 * that was already known good.
 */
const CODE_LIVENESS_TTL_MS = 60_000
const liveCodes = ttlCache<true>(CODE_LIVENESS_TTL_MS)

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
  const key = fingerprint(token)
  if (liveCodes.get(key) === true) return true

  const live = await askSessionCodeLive(token)
  if (live) liveCodes.set(key, true)
  return live
}

async function askSessionCodeLive(token: string): Promise<boolean> {
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
