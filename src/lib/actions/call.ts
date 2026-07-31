'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
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

type MaybePostgrestError = { message?: string; code?: string } | null | undefined

function friendlyDbError(error: MaybePostgrestError): string {
  const message = (error?.message ?? '').toLowerCase()
  if (message.includes('fetch failed') || message.includes('network') || message.includes('timeout')) {
    return 'Could not reach the server. Check your connection and try again.'
  }
  return 'Something went wrong saving that. Try again in a moment.'
}

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
 * and expected. It only fails with `55P03 lock_not_available` when someone
 * else genuinely holds it.
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
      // Held by someone else — fetch the row anyway so the screen can still
      // show who and until when, read-only.
      const { data: group } = await supabase
        .from('guest_groups')
        .select('*')
        .eq('id', groupId)
        .eq('event_id', eventId)
        .maybeSingle()
      return { ok: false, reason: 'locked', group: group ?? null }
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
 * `started_at` is not sent: the server stamps it via
 * `app.force_server_started_at()` regardless of what we pass, so the row
 * returned here carries the trustworthy value.
 */
export async function startCallAttempt(input: {
  eventId: string
  groupId: string
  dialedNumber: string
}): Promise<StartCallAttemptResult> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('call_attempts')
    .insert({
      event_id: input.eventId,
      group_id: input.groupId,
      dialed_number: input.dialedNumber,
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
 *   that slipped past the UI's disabled state), a `42501` is not a failure
 *   to surface to the caller — the completion already exists, exactly as
 *   intended. Callers of this action should treat `alreadyFinalized: true`
 *   the same as `ok: true`.
 */
export async function submitCallOutcome(
  payload: CallCompletionPayload,
): Promise<SubmitCallOutcomeResult> {
  const supabase = await createClient()

  const { error } = await supabase
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

  if (error) {
    const alreadyFinalized = error.code === '42501'
    return {
      ok: false,
      alreadyFinalized,
      message: alreadyFinalized
        ? 'This call was already completed — nothing more to save.'
        : friendlyDbError(error),
    }
  }

  revalidatePath(`/${payload.eventCode}/queue`)
  revalidatePath(`/${payload.eventCode}`)

  return { ok: true }
}

// ---------------------------------------------------------------------------
// release_group
// ---------------------------------------------------------------------------

export type ReleaseGroupResult = { ok: boolean }

/**
 * Drops the caller lock. `release_group()` is a silent no-op if the caller
 * does not hold it (or is not an admin) — so we re-read the row afterwards
 * rather than trusting a lack of error, per the schema guide.
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
  return { ok: !stillLocked }
}
