import { createBrowserClient } from '@supabase/ssr'

import type { Database } from './database.types'
import { capacitorStorageAdapter } from './capacitor-storage'
import { withCodeAuthFetch } from './code-auth-fetch'
import { codeTokenCache } from './code-token-cache'

/**
 * The ONE Supabase browser client. Module-level singleton — never call
 * createClient() per component. Duplicate instances cause duplicate
 * refresh-token races that log staff out mid-event.
 *
 * Storage: Capacitor Preferences on native (survives WebView cache clears),
 * localStorage on web. detectSessionInUrl is false because there is no URL
 * fragment to parse in a WebView; PKCE flow with the storage adapter.
 *
 * CODE-AUTH TRANSPORT: a code-auth (team/client) session has no GoTrue token.
 * The fetch wrapper injects the code JWT (from the durable session store) as
 * the bearer for REST/RPC calls, so RLS sees the real claims. The token is
 * read fresh on every request, so a rehydration (SessionBridge) or login
 * (CodeLoginForm) that updates the store takes effect immediately.
 */
export const supabase = createBrowserClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  {
    global: {
      fetch: withCodeAuthFetch(fetch, () => {
        // Synchronous-ish: the durable read is async; cache the last value.
        // This is set by the session-keeper on login/rehydrate. A miss falls
        // through to the anon request (no Authorization), which RLS denies —
        // correct for a genuinely anonymous user.
        return codeTokenCache.current
      }),
    },
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
 * The current code JWT for the browser client, held in memory. Written by
 * session-keeper on login/rehydrate (it is the same value the durable store
 * holds, kept in sync so the fetch wrapper is synchronous).
 */
export { codeTokenCache }

/** Back-compat alias. New code should import the `supabase` singleton
 * directly; this exists so existing callers (e.g. QueueBoard) keep working
 * and never accidentally construct a second client. */
export function createClient() {
  return supabase
}

export default supabase
