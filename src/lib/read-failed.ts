/**
 * The error a READ raises when the database did not answer (M15, M27, M28, M42).
 *
 * WHY AN ERROR AND NOT A FLAG IN THE RETURN VALUE.
 *
 * Every one of these reads had the same defect: `const { data } = await
 * supabase…`, with `error` destructured away. A transport failure, an RLS
 * refusal and a timeout all produced `[]`, and the screen rendered its EMPTY
 * state — which is a claim about the data, not about the request. "No vehicles
 * in the fleet." "No arrivals on file." "Nothing scheduled for Today." Each of
 * those sentences stops work, and the first actively invites a runner to add the
 * same cars twice.
 *
 * Some of these reads already return a discriminated union and could carry a
 * flag. Most do not, and changing their signature would ripple through every
 * caller — including tests — for a distinction that has exactly ONE right
 * handling: don't render the data. So a read that failed throws, and the caller
 * that already has an error branch (TanStack Query already surfaces a rejected
 * `queryFn` as `error`) renders it. A dropped connection genuinely IS exceptional
 * here; the bug was treating it as data.
 *
 * THIS IS NOT FOR A WRITE. A refused write has a message to show and a row to
 * roll back, and the existing `{ ok: false, message }` result shape is right for
 * it. This is only for reads, where "nothing" and "nothing loaded" must never
 * look the same.
 */
export class ReadFailedError extends Error {
  /** The screen-bound sentence, in the house voice, never a PostgREST string. */
  readonly userMessage: string

  constructor(
    /** What could not be read, in the runner's words: "the fleet". */
    what: string,
    /** The underlying database message, for the diagnostic only. */
    cause?: string,
  ) {
    super(cause ? `Could not read ${what}: ${cause}` : `Could not read ${what}.`)
    this.name = 'ReadFailedError'
    this.userMessage = `Could not load ${what}. This is a connection problem on this phone, not an empty list. Try again.`
  }
}

/** Was this throw a read failure rather than a bug? */
export function isReadFailed(error: unknown): error is ReadFailedError {
  return error instanceof ReadFailedError
}

/**
 * The message to render for a thrown read.
 *
 * A `ReadFailedError` carries its own user-facing copy. Anything else is an
 * unexpected throw and its message is the most useful thing available — callers
 * in the house voice pass it through `friendlyDbError`, never raw.
 */
export function readErrorMessage(error: unknown, what: string): string {
  if (isReadFailed(error)) return error.userMessage
  if (error instanceof Error) return error.message
  return `Could not load ${what}.`
}
