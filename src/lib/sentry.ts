import * as Sentry from '@sentry/react'

import { supabase } from '@/lib/supabase/client'

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN

/**
 * One-time Sentry init. No-op without a DSN (local dev). Environment is
 * 'dev' | 'staging' | 'production'; release matches the Android versionName.
 *
 * Call from a client module that is imported early (root layout) so the
 * global handlers are installed before app code runs.
 */
let initialized = false

export function initSentry() {
  if (initialized || !DSN) return
  initialized = true

  const env =
    process.env.NEXT_PUBLIC_APP_ENV ??
    (process.env.NODE_ENV === 'production' ? 'production' : 'dev')

  Sentry.init({
    dsn: DSN,
    environment: env,
    release: `eventops@${process.env.NEXT_PUBLIC_VERSION_NAME ?? '0.1.0'}`,
    tracesSampleRate: 0.1,
  })
}

/**
 * Tag the current staff user + event on every report. Call after auth and
 * whenever the active event changes.
 */
export async function setSentryContext(user: { id: string; role?: string } | null, eventId?: string | null) {
  if (!initialized || !DSN) return
  if (!user) {
    Sentry.setUser(null)
    Sentry.setTag('event_id', undefined)
    return
  }
  Sentry.setUser({ id: user.id, role: user.role })
  if (eventId) Sentry.setTag('event_id', eventId)
}

/** Convenience for callers that already hold the singleton. */
export { supabase }
