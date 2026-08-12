'use server'

import { createHash } from 'node:crypto'
import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { generateAccessCode } from '@/lib/auth/codes'

/**
 * Issuing access codes — the missing half of the code-auth design.
 *
 * `event_access_codes` stores `code_hash` (sha256) plus `code_prefix` and
 * `last_four` for display. There is no plaintext column and no decrypt path,
 * which is correct: a stolen database dump must not hand over every staff
 * login. But it means the plaintext exists for exactly one moment — the
 * instant it is generated — and if nobody writes it down in that moment it is
 * gone for good. On 2026-08-07 both codes for an event were shown once at
 * creation and never again; the only reason that event was recoverable is
 * that a copy happened to survive in `.env.test`. Sharma Wedding was less
 * lucky: it has no code rows at all.
 *
 * So the fix is NOT to store plaintext. It is to make re-issuing cheap and
 * obvious, which is what this module does.
 *
 * There is no permission check in TypeScript here. `app.rotate_access_code`
 * and `app.log_code_reveal` both raise 42501 for a non-admin, and
 * `event_access_codes` is `insert with check (app.is_admin())`. The database
 * is the fence; the admin layout is a UX affordance.
 */

/** Postgres insufficient_privilege — RLS or the RPC refused. */
const RLS_DENIED = '42501'

export type IssuedCode = {
  /** The plaintext, shown ONCE. Never persisted. */
  code: string
  role: 'team' | 'client'
  lastFour: string
  /** True when this replaced a live code, so old sessions just died. */
  rotated: boolean
}

export type IssueCodeResult =
  | { ok: true; issued: IssuedCode }
  | { ok: false; error: string }

function hashCode(plain: string): string {
  // The login path hashes the code with its hyphen stripped
  // (verify-access-code does the same), so this must match exactly or the
  // new code will never verify.
  return createHash('sha256').update(plain.replace('-', '')).digest('hex')
}

/**
 * Generate a fresh code for one event and one role, returning the plaintext
 * ONCE.
 *
 * Two paths, because rotation needs something to rotate:
 *   * a live row exists -> `app.rotate_access_code`, which stamps
 *     `rotated_at` on the old row and INSERTS a replacement. The retired row
 *     is kept deliberately: `app.code_is_live()` reads it to recognise and
 *     refuse sessions minted from it, so rotating is what logs out a lost
 *     phone.
 *   * no live row -> a plain insert. An event created before codes were
 *     issued (or whose code insert failed) has nothing to rotate, and
 *     `rotate_access_code` would raise P0002.
 *
 * Every issue is written to `code_reveal_log` with the admin's id, because
 * "who gave out this code, and when" has to stay answerable.
 */
export async function issueAccessCode(
  eventId: string,
  role: 'team' | 'client',
): Promise<IssueCodeResult> {
  if (role !== 'team' && role !== 'client') {
    return { ok: false, error: 'Unknown role.' }
  }

  const supabase = await createClient()

  const plain = generateAccessCode(role)
  const hash = hashCode(plain)
  const lastFour = plain.slice(-4)

  // Is there a live row for this event+role? `event_access_codes_one_live_per_role`
  // guarantees at most one, so maybeSingle is safe.
  const { data: live, error: readErr } = await supabase
    .from('event_access_codes')
    .select('id')
    .eq('event_id', eventId)
    .eq('role', role)
    .is('rotated_at', null)
    .is('revoked_at', null)
    .maybeSingle()

  if (readErr) {
    if (readErr.code === RLS_DENIED) {
      return { ok: false, error: 'Only an admin can issue access codes.' }
    }
    return { ok: false, error: `Could not read the current code: ${readErr.message}` }
  }

  const rotated = Boolean(live?.id)

  // One RPC, one transaction: retire the old row, insert the replacement,
  // write code_reveal_log. Doing these as separate round trips risked
  // retiring the live code and then failing to create its successor on a
  // link that drops roughly one connection in three — which would lock every
  // staff member out with no code left to give them.
  //
  // Cast because `issue_access_code` ships in migration 20260810190000 and
  // the generated types are regenerated from the linked project; drop the
  // cast after `npm run types:gen`.
  const { data: newCodeId, error } = await (
    supabase as unknown as {
      rpc: (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: string | null; error: { code?: string; message: string } | null }>
    }
  ).rpc('issue_access_code', {
    p_event_id: eventId,
    p_role: role,
    p_new_hash: hash,
    p_new_last_four: lastFour,
  })

  if (error) {
    if (error.code === RLS_DENIED) {
      return { ok: false, error: 'Only an admin can issue access codes.' }
    }
    return { ok: false, error: `Could not issue the code: ${error.message}` }
  }
  if (!newCodeId) {
    return { ok: false, error: 'The code was not created. Nothing was changed.' }
  }

  revalidatePath('/', 'layout')

  return { ok: true, issued: { code: plain, role, lastFour, rotated } }
}
