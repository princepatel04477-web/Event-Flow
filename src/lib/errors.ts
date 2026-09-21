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
 * WHICH room-guard refusal is this?
 *
 * `23514` is not one failure. `app.guard_room_assignment()` (formerly the two
 * halves `app.guard_room_capacity` and `app.guard_room_overlap`) raises it for
 * three different reasons, and the screen's correct next action is different
 * for each:
 *
 *   - `capacity`   — the room is at its extra-bed ceiling. Legitimately
 *                    bypassable with a written reason (`is_override`), so this
 *                    is the ONE cause that may offer the override sheet.
 *   - `overlap`    — that room already holds an active stay whose dates overlap.
 *                    No override exists: the `23514` is raised unconditionally.
 *                    Offering "add anyway" here is the same class of wrong as
 *                    offering it for a swap — it is a control that cannot work.
 *   - `date_order` — check-out before check-in. A typo in the dates, and the
 *                    fix is the dates, not the room.
 *
 * THE TRIGGER'S OWN WORDING IS THE ONLY RELIABLE DISCRIMINATOR, so that is what
 * this reads — same approach as `isFrozenRowError` above, and for the same
 * reason. The three messages are distinct in
 * `20260816150000_room_guard_row_lock.sql`: "is at max capacity (max %…)", "is
 * already booked for an overlapping stay.", "check-out % is before check-in %".
 * Everything else — including any future message the trigger learns to raise —
 * is `unknown`, which callers render as the generic refusal it is.
 *
 * `overlapOrCapacity` exists because the FIRST two causes are the ones a room
 * screen has to tell apart and the third (a date typo) reads as neither. A
 * caller that only has copy for capacity-versus-everything-else should not have
 * to know that `date_order` exists.
 *
 * Returns `null` when the error is not a room-guard `23514` at all, so a caller
 * can leave every other failure to `friendlyDbError`.
 */
export type RoomGuardCause = 'capacity' | 'overlap' | 'date_order'

export function roomGuardCause(error: MaybePostgrestError): RoomGuardCause | null {
  if (error?.code !== '23514') return null
  const m = text(error)
  if (m.includes('at max capacity')) return 'capacity'
  if (m.includes('overlapping stay')) return 'overlap'
  if (m.includes('is before check-in')) return 'date_order'
  return null
}

/**
 * The same answer, folded for a caller that only needs the pair that changes
 * what it does: the room is full (offer the override), or it is not (do not).
 *
 * `date_order` folds into `'other'` deliberately. It is not an over-capacity
 * state, so it must never reach the override path — which is exactly the bug
 * this distinction exists to close, for the second cause as well as the first.
 */
export function roomGuardCausePair(
  error: MaybePostgrestError,
): 'capacity' | 'other' | null {
  const cause = roomGuardCause(error)
  if (cause === null) return null
  return cause === 'capacity' ? 'capacity' : 'other'
}

/**
 * What to say when a room refused the write, per cause — for callers that
 * render their own copy (the v2 `GiveRoom` screen) rather than the legacy
 * "Add anyway?" prompt.
 *
 * WHY THE COPY IS HERE AND NOT IN THE SCREEN. The three sentences have to stay
 * consistent with `roomGuardCause`'s three branches; two lists that can drift
 * apart is how a screen ends up offering an override for an overlap again. One
 * place, keyed by the same union, and the compiler keeps them in step.
 */
export function roomGuardCopy(
  cause: RoomGuardCause,
  where: { roomNumber?: string | null } = {},
): string {
  const room = where.roomNumber ? `Room ${where.roomNumber}` : 'That room'
  switch (cause) {
    case 'capacity':
      return `${room} has no bed left for these guests. Choose another room, or add a written reason to put them in anyway.`
    case 'overlap':
      return `${room} is already booked for another family on overlapping dates. Pick a different room, or change the dates — there is no way to force this one through.`
    case 'date_order':
      return 'The check-out date is before the check-in date. Fix the dates and try again.'
  }
}

/**
 * The same copy, from a cause the caller already has.
 *
 * Returns `null` for `null`, so a caller can write
 * `roomGuardMessage(maybeCause, …) ?? '<its own fallback>'` and keep the
 * fallback it had. That shape is the point: this module says what a room-guard
 * refusal MEANS, never what a caller does about it.
 */
export function roomGuardMessage(
  cause: RoomGuardCause | null,
  where: { roomNumber?: string | null } = {},
): string | null {
  return cause === null ? null : roomGuardCopy(cause, where)
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
