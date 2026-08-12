/**
 * Shared fetch wrapper that presents the code-auth JWT to PostgREST.
 *
 * THE GAP THIS FIXES: RLS reads `auth.jwt()` — the claims on the request's
 * Authorization header. A code-auth (team/client) session is a JWT minted by
 * verify-access-code, but supabase-js's `_getSessionToken()` only returns the
 * GoTrue session token — which a code session does not have. So every
 * RLS-protected read/write for team/client sent no `Authorization` header,
 * `auth.jwt()` was empty, and `app.is_staff()` / `app.has_staff_identity()`
 * evaluated false: code-auth could not read or write ANYTHING.
 *
 * The fix is transport-only (no schema/RLS/RPC change): wrap the client's
 * fetch so that when a code JWT is available, it becomes the Authorization
 * bearer for Supabase REST/RPC requests. supabase-js accepts this via
 * `global: { fetch }`.
 *
 * The token source is injected by the caller (server: the httpOnly cookie;
 * browser: Capacitor Preferences / localStorage). This module is pure.
 */
export function withCodeAuthFetch(
  fetchImpl: typeof fetch,
  getCodeToken: () => string | null,
): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const token = getCodeToken()
    if (!token) return fetchImpl(input, init)

    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    // Only inject into Supabase API calls, never edge functions or auth.
    const isSupabaseRest =
      /rest\/v1\/|\/rpc\//.test(url) && url.includes('supabase.co')

    if (!isSupabaseRest) return fetchImpl(input, init)

    const headers = new Headers(init?.headers)
    headers.set('Authorization', `Bearer ${token}`)

    return fetchImpl(input, { ...init, headers })
  }
}
