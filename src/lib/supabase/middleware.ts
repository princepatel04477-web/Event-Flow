import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

import type { Database } from './database.types'
import { CODE_AUTH_COOKIE } from '@/lib/auth/cookies'
import { verifyCodeAuthToken } from '@/lib/auth/claims'

/** Routes reachable without a session. */
const PUBLIC_PATHS = ['/login', '/admin/login', '/auth', '/pick-staff']

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
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  )

  if (codeClaims) return response

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

  // getUser() revalidates the token against Supabase. Do not swap this for
  // getSession(), which trusts whatever is in the cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // codeClaims was already resolved above and returned early when present,
  // so reaching here means there is no valid code session.
  const hasSession = Boolean(user)

  if (!hasSession && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  return response
}
