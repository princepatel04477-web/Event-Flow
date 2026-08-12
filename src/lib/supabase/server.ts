import 'server-only'

import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

import type { Database } from './database.types'
import { withCodeAuthFetch } from './code-auth-fetch'
import { CODE_AUTH_COOKIE } from '@/lib/auth/cookies'

/**
 * Server-side Supabase client for server components, server actions and route
 * handlers. `cookies()` is async in Next 15, so this is async too.
 *
 * A fresh client per call, on purpose. The cookie store is request-scoped and
 * must never be shared across requests: a memoised client (React `cache()` or
 * a module singleton) can leak one request's session into another's reads —
 * the RSVP 404 regression was exactly that (a cached client bound to an
 * anonymous request reused by an admin's page). The client object itself is
 * cheap; the cost is one `cookies()` read per call.
 *
 * Never construct a service-role client here. Every write in this app is meant
 * to run as the signed-in staff user so that RLS and the audit triggers record
 * who actually did it — see the audit_log table.
 *
 * CODE-AUTH TRANSPORT: a code-auth (team/client) session has no GoTrue token,
 * so supabase-js would send no `Authorization` header and RLS (`auth.jwt()`)
 * would see no claims. The fetch wrapper injects the code JWT (from the
 * httpOnly cookie) as the bearer for REST/RPC calls, so `app.is_staff()` /
 * `app.has_staff_identity()` evaluate against the real claims. Transport only.
 */
export async function createClient() {
  const cookieStore = await cookies()
  const codeToken = cookieStore.get(CODE_AUTH_COOKIE)?.value ?? null

  const fetchWithCode = withCodeAuthFetch(
    fetch,
    () => codeToken,
  )

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        fetch: fetchWithCode,
      },
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Called from a server component, where cookies are read-only.
            // Session refresh is handled by middleware, so this is safe to swallow.
          }
        },
      },
    },
  )
}
