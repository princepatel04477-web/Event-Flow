import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

import type { Database } from './database.types'
import { CODE_AUTH_COOKIE } from '@/lib/auth/cookies'
import { verifyCodeAuthToken } from '@/lib/auth/claims'

/** Routes reachable without a session. */
const PUBLIC_PATHS = ['/login', '/admin/login', '/auth', '/pick-staff']

/**
 * Routes reachable without a session, matched EXACTLY — no sub-paths.
 *
 * `/api/version` is the deployment-truth probe. It has to answer before a
 * session can exist, or it cannot tell you what is deployed when login itself
 * is the thing that is broken.
 *
 * `/api/media/internal` is how `transcribe-recording` reads audio out of R2.
 * It runs on Supabase with no session and no cookie, so the bounce to /login
 * would hand it a redirect where it expects bytes — and the symptom would be
 * "transcription silently stopped working for every new recording", with a
 * 307 nobody thinks to look at. It is NOT unauthenticated: the route itself
 * requires MEDIA_FETCH_SECRET and 404s without it. What is exempted here is
 * the session wall, not the auth.
 *
 * (`public/install.html` and the import template `.xlsx` were the same class
 * of bug, fixed in the proxy's matcher — see the note on `config` there.)
 *
 * Both are kept OUT of PUBLIC_PATHS deliberately: that list also matches
 * `${p}/`, which would open every future sub-route to anonymous callers as a
 * side effect. Exact-only means exposing a sub-route later has to be a
 * deliberate act rather than an inherited default.
 */
const PUBLIC_PATHS_EXACT = ['/api/version', '/api/media/internal']

/**
 * Refreshes the auth session on every request and bounces anonymous users to
 * /login.
 *
 * Two session types are accepted:
 *   * a GoTrue session (admin) — refreshed via getUser()
 *   * a code-auth session (team/client) — verified directly from the
 *     httpOnly cookie; not a GoTrue token, so getUser() would reject it.
 *
 * Role routing does NOT happen here. Middleware runs on the edge and cannot be
 * trusted with authorisation decisions — it only knows there is a session, not
 * what that session is allowed to see. Every page still queries under RLS, and
 * a client login reaching a staff route gets empty results rather than data.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  // Check the code-auth cookie FIRST. A team/client session is not a GoTrue
  // session, so `auth.getUser()` can only ever answer null for it — but it is
  // still constructed and called on every request, and supabase-js will hit
  // the network whenever any sb-* cookie is lying around. The 10-20 staff on
  // this app are all code sessions, so that was a wasted round trip on the
  // hot path, before the page even began rendering.
  //
  // The JWT is verified locally (signature + expiry), so this branch costs no
  // network at all. An admin still falls through to getUser() below, which
  // must keep revalidating against GoTrue — never swap that for getSession().
  const codeToken = request.cookies.get(CODE_AUTH_COOKIE)?.value
  const codeClaims = codeToken ? await verifyCodeAuthToken(codeToken) : null

  const { pathname } = request.nextUrl
  const isPublic =
    PUBLIC_PATHS_EXACT.includes(pathname) ||
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))

  if (codeClaims) return response

  // Check if any Supabase auth cookies exist before incurring GoTrue work.
  // Without any sb-* cookie, we know there cannot be a GoTrue session.
  const hasSbCookies = request.cookies.getAll().some((c) => c.name.startsWith('sb-'))

  // Fast path for public routes without GoTrue cookies: avoid constructing the client
  // or hitting the network.
  if (isPublic && !hasSbCookies) {
    return response
  }

  // Fast path for unauthenticated requests on protected routes: redirect immediately
  // to login instead of waiting for a network round trip to return null.
  if (!hasSbCookies && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // getClaims() verifies the JWT signature against the project's ES256 JWKS
  // (fetched once, then cached in-process), and refreshes an expired session
  // through getSession() internally. getUser() did the same check with a
  // round trip to GoTrue in Seoul on EVERY admin click — the single biggest
  // reason admin navigation was ~3x slower than team. Never swap this for
  // getSession(), which trusts whatever is in the cookie unverified.
  const { data: authData } = await supabase.auth.getClaims()

  // codeClaims was already resolved above and returned early when present,
  // so reaching here means there is no valid code session.
  const hasSession = Boolean(authData?.claims?.sub)

  if (!hasSession && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  return response
}
