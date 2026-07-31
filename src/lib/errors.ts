/**
 * Turning raw Postgres/PostgREST failures into sentences a staff member
 * standing in a corridor can act on.
 *
 * Three slices each wrote their own version of this. Consolidated here so a
 * given failure reads the same wherever it surfaces.
 *
 * Pure and dependency-free — safe to import from server actions and client
 * components alike.
 */

export type MaybePostgrestError =
  | { message?: string | null; code?: string | null; details?: string | null }
  | null
  | undefined

function text(error: MaybePostgrestError): string {
  return `${error?.message ?? ''} ${error?.details ?? ''}`.toLowerCase()
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

/** Generic, honest fallback for a failed write. */
export function friendlyDbError(error: MaybePostgrestError): string {
  if (isNetworkError(error)) {
    return 'Could not reach the server. Check your connection and try again.'
  }
  if (error?.code === '42501') {
    return 'The database refused that — your account may not have permission on this event.'
  }
  if (error?.code === '55P03') {
    return 'Someone else is holding this record right now. Try again in a moment.'
  }
  return 'Something went wrong saving that. Try again in a moment.'
}

/** Wording for the review screen, where the failure came out of an RPC. */
export function friendlyRpcError(error: MaybePostgrestError): string {
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

  return 'Could not save this review. Try again in a moment.'
}
