/**
 * Turning raw Postgres/PostgREST failures into sentences a staff member
 * standing in a corridor can act on.
 *
 * Three slices each wrote their own version of this. Consolidated here so a
 * given failure reads the same wherever it surfaces.
 *
 * Pure and dependency-free — safe to import from server actions and client
 * components alike. For constraint violations and other errors a user message
 * alone cannot diagnose, pass a `reporter` callback that logs the SQLSTATE,
 * constraint name, and call-site context to Sentry or wherever diagnostics go.
 */

export type MaybePostgrestError =
  | { message?: string | null; code?: string | null; details?: string | null }
  | null
  | undefined

export interface ErrorLogContext {
  /** Call-site label, e.g. "startCallAttempt", "submitProof". */
  route: string
  /** The SQLSTATE or PostgREST error code. */
  code: string | null
  /** The constraint name, when the message carries one. */
  constraint: string | null
  /** Caller identity for narrowing the log entry. */
  staffMemberId: string | null
}

export type ErrorReporter = (ctx: ErrorLogContext) => void

function text(error: MaybePostgrestError): string {
  return `${error?.message ?? ''} ${error?.details ?? ''}`.toLowerCase()
}

/** Extract the constraint name from a Postgres error message, or null. */
function extractConstraint(error: MaybePostgrestError): string | null {
  if (!error?.message) return null
  const match = /constraint\s+"(\w+)"/i.exec(error.message)
  return match?.[1] ?? null
}

/** True when the failure is "the network went away", not "the database said no". */
export function isNetworkError(error: MaybePostgrestError): boolean {
  const m = text(error)
  return (
    m.includes('fetch failed') ||
    m.includes('network') ||
    m.includes('timeout') ||
    m.includes('econnrefused') ||
    m.includes('socket hang up')
  )
}

/**
 * `42501` is raised by BOTH `app.guard_call_attempt()` (the row is frozen —
 * expected, harmless) and by a revoked grant / denied policy (a real
 * misconfiguration). They are not the same thing and must not be reported
 * the same way, so match on the trigger's own wording.
 */
export function isFrozenRowError(error: MaybePostgrestError): boolean {
  if (error?.code !== '42501') return false
  const m = text(error)
  return m.includes('finalized') || m.includes('cannot be edited')
}

/**
 * Log a constraint violation to the reporter when one is provided, so the
 * call site's diagnostics surface records the SQLSTATE and constraint name
 * rather than forcing a developer to reproduce it blind.
 */
export function reportConstraintViolation(
  error: MaybePostgrestError,
  ctx: { route: string; staffMemberId?: string | null },
  reporter?: ErrorReporter,
): void {
  if (!reporter || !error) return
  reporter({
    route: ctx.route,
    code: error?.code ?? null,
    constraint: extractConstraint(error),
    staffMemberId: ctx.staffMemberId ?? null,
  })
}

/** Generic, honest fallback for a failed write. */
export function friendlyDbError(
  error: MaybePostgrestError,
  reporter?: ErrorReporter,
  callSite?: string,
): string {
  if (isNetworkError(error)) {
    return 'Could not reach the server. Check your connection and try again.'
  }
  if (error?.code === '42501') {
    return 'The database refused that — your account may not have permission on this event.'
  }
  if (error?.code === '55P03') {
    return 'Someone else is holding this record right now. Try again in a moment.'
  }
  // 23514 = CHECK violation. The user cannot fix this, so the message says
  // exactly that — but the diagnostic is logged so the developer can trace it.
  if (error?.code === '23514' && reporter && callSite) {
    reporter({
      route: callSite,
      code: '23514',
      constraint: extractConstraint(error),
      staffMemberId: null,
    })
  }
  return 'Something went wrong saving that. Try again in a moment.'
}

/** Wording for the review screen, where the failure came out of an RPC. */
export function friendlyRpcError(
  error: MaybePostgrestError,
  reporter?: ErrorReporter,
  callSite?: string,
): string {
  const m = text(error)

  if (m.includes('already been applied')) {
    return 'This extraction has already been applied. Refresh the review queue.'
  }
  if (m.includes('lock_not_available') || m.includes('locked by another')) {
    return 'This group is locked by another caller right now. Try again shortly.'
  }
  if (error?.code === '42501' || m.includes('not permitted')) {
    return 'You do not have permission to apply this extraction.'
  }
  if (m.includes('invalid input value for enum')) {
    return 'One of the fields has a value the database does not recognise. Check the RSVP status and side fields.'
  }
  if (m.includes('invalid input syntax for type integer')) {
    return 'Confirmed pax or a leg’s pax must be a whole number.'
  }
  if (isNetworkError(error)) {
    return 'Could not reach the server. Check your connection and try again.'
  }
  if (error?.code === '23514' && reporter && callSite) {
    reporter({
      route: callSite,
      code: '23514',
      constraint: extractConstraint(error),
      staffMemberId: null,
    })
  }

  return 'Could not save this review. Try again in a moment.'
}
