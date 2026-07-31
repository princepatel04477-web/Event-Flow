'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { friendlyDbError, isFrozenRowError } from '@/lib/errors'
import type { CallCompletionPayload, CallAttemptRow, GuestGroupRow } from '@/lib/call/types'

/**
 * Server actions for the call screen (p1f).
 *
 * Everything here runs as the signed-in staff user via the cookie-scoped
 * Supabase client — never a service-role key — so RLS and the audit
 * triggers see the real caller. See CLAUDE.md §5 for why that matters:
 * `call_attempts` is append-only with one-shot completion, so these actions
 * are deliberately narrow: claim, start, submit-once, release. Nothing here
 * ever issues a second UPDATE to a row that already has an outcome.
 */

// ---------------------------------------------------------------------------
// claim_group — the 15-minute caller lock
// ---------------------------------------------------------------------------

export type ClaimGroupResult =
  | { ok: true; group: GuestGroupRow }
  | { ok: false; reason: 'locked'; group: GuestGroupRow | null }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'error'; message: string }

/**
 * Claims (or re-claims) the 15-minute caller lock on a group.
 *
 * `claim_group()` is re-entrant for its current holder — calling this again
 * on a page refresh, or to extend a lock that is about to expire, is safe
 * and expected.
 *
 * `55P03` does NOT mean "locked". The RPC raises it whenever its UPDATE
 * matches nothing, which also covers a group id that does not exist and a
 * caller for whom `app.is_staff()` is false. Rendering all three as "someone
 * else is already calling this family" turns a permission denial into a
 * message promising the lock will release on its own. So the row is re-read
 * and the cases are told apart: a group we cannot see is `not_found`, which
 * is the honest answer for a stale id and for a client-role account alike.
 */
export async function claimGroupForCall(
  eventId: string,
  groupId: string,
  minutes = 15,
): Promise<ClaimGroupResult> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('claim_group', {
    p_group_id: groupId,
    p_minutes: minutes,
  })

  if (error) {
    if (error.code === '55P03') {
      const { data: group } = await supabase
        .from('guest_groups')
        .select('*')
        .eq('id', groupId)
        .eq('event_id', eventId)
        .maybeSingle()

      // Zero rows here means the group does not exist, belongs to another
      // event, or this account is not staff on it. None of those is a lock.
      if (!group) return { ok: false, reason: 'not_found' }

      return { ok: false, reason: 'locked', group }
    }
    return { ok: false, reason: 'error', message: friendlyDbError(error) }
  }

  if (!data || data.event_id !== eventId) {
    return { ok: false, reason: 'not_found' }
  }

  return { ok: true, group: data }
}

// ---------------------------------------------------------------------------
// call_attempts — start (write BEFORE tel: fires)
// ---------------------------------------------------------------------------

export type StartCallAttemptResult =
  | { ok: true; attempt: CallAttemptRow }
  | { ok: false; message: string }

/**
 * Creates the `call_attempts` row. Must complete BEFORE the `tel:` link
 * fires — Android may discard all page state the instant the dialer opens,
 * so this is the only guaranteed place to record that a call happened.
 *
 * `deviceStartedAt` is the PHONE's clock, taken in the browser. It is sent
 * as `started_at` because `app.force_server_started_at()` moves whatever
 * arrives in that column into `device_started_at` and then stamps
 * `started_at` from the server. Omitting it (as this used to) meant the
 * column default `now()` — server time — got copied into `device_started_at`,
 * so the column documented as "phone clock, untrusted" silently held a
 * second copy of the server clock and the skew the schema was designed to
 * capture was never recorded.
 */
export async function startCallAttempt(input: {
  eventId: string
  groupId: string
  dialedNumber: string
  /** ISO timestamp from the phone. Untrusted by design — the server overrides `started_at`. */
  deviceStartedAt?: string
}): Promise<StartCallAttemptResult> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('call_attempts')
    .insert({
      event_id: input.eventId,
      group_id: input.groupId,
      dialed_number: input.dialedNumber,
      ...(input.deviceStartedAt ? { started_at: input.deviceStartedAt } : {}),
    })
    .select()
    .single()

  if (error || !data) {
    return { ok: false, message: friendlyDbError(error) }
  }

  return { ok: true, attempt: data }
}

// ---------------------------------------------------------------------------
// call_attempts — submit outcome (the ONE update; freezes the row)
// ---------------------------------------------------------------------------

export type SubmitCallOutcomeResult =
  | { ok: true }
  | { ok: false; alreadyFinalized: boolean; message: string }

/**
 * The single freezing update. `app.guard_call_attempt()` stamps
 * `finalized_at` the instant `outcome` goes from null to non-null, and every
 * update after that raises `42501`. So:
 *
 * - This must only ever be called once per attempt with a real outcome.
 * - If it somehow runs twice (a retried offline-queue drain, a double tap
 *   that slipped past the UI's disabled state), a `42501` RAISED BY THE
 *   FREEZE TRIGGER is not a failure — the completion already exists, exactly
 *   as intended. Callers should treat `alreadyFinalized: true` as `ok: true`.
 *
 * Two things this gets right that are easy to get wrong:
 *
 * 1. `.select()` is mandatory. Without it PostgREST returns 204 with
 *    `error === null` whether one row matched or zero — identical to the
 *    documented delete trap. A zero-row update (expired session so
 *    `auth.uid()` is null and the RLS USING clause matches nothing, wrong
 *    event_id, a cascaded row) would be reported as success, the outbox
 *    would delete the queued completion, and the outcome would be gone for
 *    good while the row stayed `outcome IS NULL` forever.
 * 2. `42501` is ALSO what a revoked grant returns. Only the freeze trigger's
 *    own wording counts as "already completed" (see isFrozenRowError);
 *    anything else is a real permissions failure and must stay queued.
 */
export async function submitCallOutcome(
  payload: CallCompletionPayload,
): Promise<SubmitCallOutcomeResult> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('call_attempts')
    .update({
      ended_at: payload.endedAt,
      duration_sec: payload.durationSec,
      outcome: payload.outcome,
      notes: payload.notes,
      callback_at: payload.callbackAt,
    })
    .eq('id', payload.attemptId)
    .eq('event_id', payload.eventId)
    .select('id')

  if (error) {
    const alreadyFinalized = isFrozenRowError(error)
    return {
      ok: false,
      alreadyFinalized,
      message: alreadyFinalized
        ? 'This call was already completed — nothing more to save.'
        : friendlyDbError(error),
    }
  }

  if (!data || data.length === 0) {
    return {
      ok: false,
      alreadyFinalized: false,
      message:
        'The outcome was not saved — the database matched no such call for your account. ' +
        'Your session may have expired. Sign in again; this outcome is still held on this phone.',
    }
  }

  revalidatePath(`/${payload.eventCode}/queue`)
  revalidatePath(`/${payload.eventCode}`)

  return { ok: true }
}

// ---------------------------------------------------------------------------
// release_group
// ---------------------------------------------------------------------------

export type ReleaseGroupResult = { ok: boolean; message?: string }

/**
 * Drops the caller lock. `release_group()` is a silent no-op if the caller
 * does not hold it (or is not an admin) — so we re-read the row afterwards
 * rather than trusting a lack of error, per the schema guide.
 *
 * Callers MUST look at the result. A caller whose lock was taken over after
 * it expired gets nothing from the RPC; telling them the family is released
 * when it stays locked for another 15 minutes is worse than saying nothing.
 */
export async function releaseGroupAfterCall(
  eventId: string,
  groupId: string,
  eventCode: string,
): Promise<ReleaseGroupResult> {
  const supabase = await createClient()

  await supabase.rpc('release_group', { p_group_id: groupId })

  const { data } = await supabase
    .from('guest_groups')
    .select('locked_by, locked_until')
    .eq('id', groupId)
    .eq('event_id', eventId)
    .maybeSingle()

  revalidatePath(`/${eventCode}/queue`)

  const stillLocked = Boolean(
    data?.locked_by && data.locked_until && new Date(data.locked_until).getTime() > Date.now(),
  )

  if (stillLocked) {
    return {
      ok: false,
      message:
        'This family is still locked — the claim now belongs to someone else, so you could not release it. It clears on its own within 15 minutes.',
    }
  }

  return { ok: true }
}
