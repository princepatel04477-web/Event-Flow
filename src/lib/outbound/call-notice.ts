/**
 * What the auto-call board says after "Call the next family".
 *
 * WHY THIS IS NOT INLINE. The rule was written in
 * `src/lib/actions/outbound.ts` as
 * `body.message ?? body.started ? 'Call started' : 'Job queued'`, which
 * parses as `(body.message ?? body.started) ? … : …` — so ANY truthy
 * `body.message` was thrown away and the screen said "Call started" even for
 * a job that was only queued and never dialled. The corrected precedence is
 * `body.message ?? (body.started ? 'Call started' : 'Job queued')`.
 *
 * A `'use server'` module may only export async functions, so the rule lives
 * here where vitest can reach it and precedent is pinned by a test.
 */
export function callStartNotice(body: { message?: unknown; started?: unknown }): string {
  // A real sentence from the dialer wins over anything we would guess. An
  // empty string is not a sentence, so it falls through to the state.
  if (typeof body.message === 'string' && body.message.trim() !== '') {
    return body.message
  }
  return body.started ? 'Call started' : 'Job queued'
}

export default callStartNotice
