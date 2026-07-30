import { createBrowserClient } from '@supabase/ssr'

import type { Database } from './database.types'

/**
 * Browser-side Supabase client. Safe to call in client components.
 *
 * Everything this client touches is fenced by RLS on `event_id`, so there is no
 * such thing as "trusted" data coming back from it — the database decides.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
