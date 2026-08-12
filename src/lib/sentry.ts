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

/**
 * Report a swallowed write failure with its SQLSTATE.
 *
 * The call-save path returns a user-facing sentence and keeps the outcome on
 * the phone — correct for the staff member, useless for diagnosis, because the
 * SQLSTATE and constraint name never left the device. Server actions log to
 * the Vercel console, but a queued-and-never-drained completion produces no
 * server log at all: the request never arrived. This is the client-side half,
 * and it is the only half that exists for offline failures.
 *
 * A no-op without a DSN, so local dev is unaffected.
 *
 * @param route      Call-site label, e.g. 'submitCallOutcome'.
 * @param diagnostic The `step=… code=… constraint=… at=…` string from the action.
 * @param extra      Ids for narrowing. Never put guest names or numbers here.
 */
export function captureDiagnostic(
  route: string,
  diagnostic: string | undefined,
  extra: Record<string, string | number | boolean | null | undefined> = {},
) {
  if (!initialized || !DSN) return
  const sqlstate = /code=(\S+)/.exec(diagnostic ?? '')?.[1] ?? 'unknown'
  Sentry.withScope((scope) => {
    scope.setTag('route', route)
    scope.setTag('sqlstate', sqlstate)
    scope.setContext('diagnostic', { diagnostic: diagnostic ?? '(none)', ...extra })
    scope.setLevel('error')
    Sentry.captureMessage(`${route} failed (${sqlstate})`)
  })
}

/** Convenience for callers that already hold the singleton. */
export { supabase }
