import { supabase } from '@/lib/supabase/client'

/**
 * Sentry, loaded only when something is actually being reported.
 *
 * ── WHY THIS MODULE NO LONGER IMPORTS THE SDK ───────────────────────────────
 *
 * `import * as Sentry from '@sentry/react'` at the top of this file put the whole
 * SDK — core plus the React wrapper, ~66 KB of JavaScript raw, ~25 KB gzipped —
 * into the first load of EVERY staff screen. Two callers guaranteed it: the root
 * layout's error boundary, which is on every route, and `captureDiagnostic()`,
 * which the call screen and the calling queue import.
 *
 * That cost was paid for a reporter that cannot report: `initSentry()` was only
 * ever called from a `typeof window !== 'undefined'` branch inside a SERVER
 * component, and there is no `NEXT_PUBLIC_SENTRY_DSN` in any environment this app
 * has. Every function below already returned early on `!DSN`, so the SDK was
 * downloaded on every navigation in order to be ignored.
 *
 * So the import is dynamic, inside `sdk()`, and every entry point is a no-op
 * without a DSN — the same behaviour, minus the download. Call sites are
 * unchanged: this module still exports the same named functions, which is the
 * point. A screen does not have to know how its diagnostics travel.
 *
 * `captureDiagnostic` and `captureError` are therefore fire-and-forget. They
 * always were, from the caller's side: both returned `void` and neither could
 * report a failure anywhere useful.
 */

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN

let initialized = false

/**
 * Load the SDK, and initialise it the first time. Returns null with no DSN.
 *
 * `initialized` is set BEFORE `init()` is awaited so two concurrent reports
 * cannot both initialise; `init()` itself is synchronous once the module is in.
 */
async function sdk(): Promise<typeof import('@sentry/react') | null> {
  if (!DSN) return null
  const Sentry = await import('@sentry/react')
  if (!initialized) {
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
  return Sentry
}

/**
 * One-time Sentry init. No-op without a DSN (local dev). Environment is
 * 'dev' | 'staging' | 'production'; release matches the Android versionName.
 *
 * Kept exported, and synchronous, for its one caller in the root layout — which
 * reaches it only inside a `typeof window !== 'undefined'` branch in a server
 * component, so in practice the first real report is what initialises the SDK.
 * With no DSN this returns without importing anything.
 */
export function initSentry(): void {
  void sdk().catch(() => {
    /* reporting is best-effort by definition */
  })
}

/**
 * Tag the current staff user + event on every report. Call after auth and
 * whenever the active event changes.
 */
export async function setSentryContext(
  user: { id: string; role?: string } | null,
  eventId?: string | null,
): Promise<void> {
  const Sentry = await sdk().catch(() => null)
  if (!Sentry) return
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
): void {
  if (!DSN) return
  const sqlstate = /code=(\S+)/.exec(diagnostic ?? '')?.[1] ?? 'unknown'
  void sdk()
    .then((Sentry) => {
      if (!Sentry) return
      Sentry.withScope((scope) => {
        scope.setTag('route', route)
        scope.setTag('sqlstate', sqlstate)
        scope.setContext('diagnostic', { diagnostic: diagnostic ?? '(none)', ...extra })
        scope.setLevel('error')
        Sentry.captureMessage(`${route} failed (${sqlstate})`)
      })
    })
    .catch(() => {
      /* reporting is best-effort by definition */
    })
}

/**
 * Report an error caught by the shell's error boundary.
 *
 * The boundary used to import the SDK statically in order to render a card. The
 * card is the job; the SDK now arrives on the error path, from here.
 */
export function captureError(error: unknown, componentStack: string | null = null): void {
  if (!DSN) return
  void sdk()
    .then((Sentry) => {
      if (!Sentry) return
      Sentry.withScope((scope) => {
        if (componentStack) scope.setContext('react', { componentStack })
        scope.setLevel('error')
        Sentry.captureException(error)
      })
    })
    .catch(() => {
      /* the fallback card is the contract; reporting is best-effort */
    })
}

/** Convenience for callers that already hold the singleton. */
export { supabase }
