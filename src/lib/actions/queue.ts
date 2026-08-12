import { supabase } from '@/lib/supabase/client'
import { friendlyDbError } from '@/lib/errors'

/**
 * Postgres raises this SQLSTATE from `claim_group()` when its UPDATE matches
 * nothing. That covers THREE distinct situations, not one:
 *
 *   1. another caller currently holds the lock,
 *   2. `p_group_id` does not exist (a stale row in a queue nobody refreshed),
 *   3. `app.is_staff(g.event_id)` is false for this account.
 *
 * They must not all be reported as "someone else is on this call" — that
 * sends a caller chasing a colleague who was never on it, and tells a
 * client-role account that a permission denial is a transient lock. See
 * [[Views and RPCs]] in the Obsidian vault.
 */
const LOCK_NOT_AVAILABLE = '55P03'

export type ClaimGroupResult =
  | { ok: true }
  | { ok: false; reason: 'locked'; message: string }
  | { ok: false; reason: 'gone'; message: string }
  | { ok: false; reason: 'error'; message: string }

/**
 * Claim a group's 15-minute caller lock via the `claim_group()` RPC.
 *
 * Runs as the signed-in user, so RLS and `locked_by` reflect who actually
 * claimed it. The RPC is re-entrant for its current holder — a caller
 * reopening their own call succeeds instead of failing.
 *
 * Deliberately does not `redirect()` on success: it is invoked from a plain
 * button click rather than a `<form action>`, so the caller navigates itself
 * once it sees `{ ok: true }`.
 */
export async function claimGroupAction(groupId: string): Promise<ClaimGroupResult> {
  if (!groupId) {
    return { ok: false, reason: 'error', message: 'Missing group id.' }
  }
  const { error } = await supabase.rpc('claim_group', { p_group_id: groupId })

  if (!error) return { ok: true }

  if (error.code !== LOCK_NOT_AVAILABLE) {
    return { ok: false, reason: 'error', message: friendlyDbError(error) }
  }

  // Re-read the row to tell the three cases apart. A row we cannot see is
  // either gone or outside our access — both mean "stop waiting for it",
  // and neither should name a colleague who is not there.
  const { data: group } = await supabase
    .from('guest_groups')
    .select('locked_until')
    .eq('id', groupId)
    .maybeSingle()

  if (!group) {
    return {
      ok: false,
      reason: 'gone',
      message:
        'This family is not available to you any more — it may have been removed, or your access to this event changed. Refresh the queue.',
    }
  }

  const heldUntil = group.locked_until ? new Date(group.locked_until) : null
  const stillHeld = heldUntil !== null && heldUntil.getTime() > Date.now()

  return {
    ok: false,
    reason: 'locked',
    message: stillHeld
      ? 'Someone else is calling this family right now. The lock releases automatically.'
      : 'Could not open this call just now — another caller claimed it a moment ago. Try again.',
  }
}
