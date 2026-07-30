import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

import type { Database } from './database.types'

/** Routes reachable without a session. */
const PUBLIC_PATHS = ['/login', '/auth']

/**
 * Refreshes the auth session on every request and bounces anonymous users to
 * /login.
 *
 * Role routing does NOT happen here. Middleware runs on the edge and cannot be
 * trusted with authorisation decisions — it only knows there is a session, not
 * what that session is allowed to see. Every page still queries under RLS, and
 * a client login reaching a staff route gets empty results rather than data.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

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

  const { pathname } = request.nextUrl
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  )

  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  return response
}
