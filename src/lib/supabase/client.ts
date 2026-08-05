import { createBrowserClient } from '@supabase/ssr'

import type { Database } from './database.types'
import { capacitorStorageAdapter } from './capacitor-storage'

/**
 * The ONE Supabase browser client. Module-level singleton — never call
 * createClient() per component. Duplicate instances cause duplicate
 * refresh-token races that log staff out mid-event.
 *
 * Storage: Capacitor Preferences on native (survives WebView cache clears),
 * localStorage on web. detectSessionInUrl is false because there is no URL
 * fragment to parse in a WebView; PKCE flow with the storage adapter.
 */
export const supabase = createBrowserClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      storage: capacitorStorageAdapter,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
  },
)

/**
 * Back-compat alias. New code should import the `supabase` singleton
 * directly; this exists so existing callers (e.g. QueueBoard) keep working
 * and never accidentally construct a second client.
 */
export function createClient() {
  return supabase
}

export default supabase
