'use server'

import { createClient } from '@/lib/supabase/server'

/**
 * Postgres raises this SQLSTATE from `claim_group()` when another caller
 * currently holds the lock. See [[Views and RPCs]] in the Obsidian vault.
 */
const LOCK_NOT_AVAILABLE = '55P03'

export type ClaimGroupResult =
  | { ok: true }
  | { ok: false; reason: 'locked'; message: string }
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

  const supabase = await createClient()
  const { error } = await supabase.rpc('claim_group', { p_group_id: groupId })

  if (error) {
    if (error.code === LOCK_NOT_AVAILABLE) {
      return {
        ok: false,
        reason: 'locked',
        message: 'Someone else is calling this family right now.',
      }
    }

    return {
      ok: false,
      reason: 'error',
      message: 'Could not open this call. Try again.',
    }
  }

  return { ok: true }
}
