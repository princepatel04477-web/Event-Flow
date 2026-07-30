import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

import type { Database } from './database.types'

/**
 * Server-side Supabase client for server components, server actions and route
 * handlers. `cookies()` is async in Next 15, so this is async too.
 *
 * Never construct a service-role client here. Every write in this app is meant
 * to run as the signed-in staff user so that RLS and the audit triggers record
 * who actually did it — see the audit_log table.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
