import { supabase } from '@/lib/supabase/client'

import type { RawSnapshot } from './types'

/**
 * The two RPC calls behind the store, and the feature detection that lets this
 * code deploy BEFORE its migration.
 *
 * THE DEPLOY ORDER IS THE HARD CONSTRAINT. This job ships a client that wants
 * `public.event_snapshot`, but the migration is applied by somebody else, later,
 * separately — and in remote-shell mode a Vercel deploy reaches every handset
 * within seconds while `supabase db push` reaches nobody until it is run. So
 * there is a real window in which the new app meets a database without the
 * function. In that window the app must work exactly as it did before, which
 * means: detect, and fall back to the reads the screens already had.
 *
 * THE DETECTION IS ON THE ERROR, NOT ON A VERSION PROBE. A probe would be a
 * second round trip on every cold start to answer a question the first call
 * answers anyway. PostgREST says `PGRST202` ("Could not find the function …
 * in the schema cache") for a missing function and `PGRST203` for an
 * ambiguous overload; both mean "this database does not have the RPC". A
 * `404` is included because older PostgREST versions answered that way.
 * Anything else — 42501, a 5xx, a dropped connection — is a REAL error, and
 * treating it as "not deployed" would silently downgrade a broken database to
 * the slow path forever, which is how a performance fix gets reverted by a
 * blip.
 *
 * See `supabase/migrations/20260922120000_event_snapshot.sql`.
 */

const MISSING_FUNCTION_CODES = new Set(['PGRST202', 'PGRST203', '42883', '404'])

export type SnapshotRpcResult =
  | { ok: true; payload: RawSnapshot }
  /** The database does not have the function. Fall back and stay there. */
  | { ok: false; unsupported: true; message: string }
  /** Something else went wrong. Keep the cache; try again later. */
  | { ok: false; unsupported: false; message: string }

function describe(error: { code?: string; message?: string; details?: string }): string {
  return error.message ?? error.details ?? error.code ?? 'The request failed.'
}

function isMissingFunction(error: { code?: string; message?: string }): boolean {
  if (error.code && MISSING_FUNCTION_CODES.has(error.code)) return true
  const message = error.message ?? ''
  return (
    /could not find the function/i.test(message) ||
    /does not exist/i.test(message) ||
    /schema cache/i.test(message)
  )
}

/** One full event. The only read on the cold-start path. */
export async function fetchEventSnapshot(eventId: string): Promise<SnapshotRpcResult> {
  try {
    const { data, error } = await supabase.rpc('event_snapshot', { p_event_id: eventId })

    if (error) {
      return isMissingFunction(error)
        ? { ok: false, unsupported: true, message: describe(error) }
        : { ok: false, unsupported: false, message: describe(error) }
    }
    if (data === null || data === undefined) {
      // A 200 with no body is not a missing function; it is a broken response,
      // and pretending otherwise would downgrade the app on a server bug.
      return { ok: false, unsupported: false, message: 'The snapshot came back empty.' }
    }
    return { ok: true, payload: data as RawSnapshot }
  } catch (e) {
    // A thrown fetch is a transport failure (offline, DNS, a reset socket).
    // Never "unsupported": the function may be there and the link may not.
    return {
      ok: false,
      unsupported: false,
      message: e instanceof Error ? e.message : 'Could not reach the server.',
    }
  }
}

/** Everything that changed since `since` — the resume catch-up call. */
export async function fetchEventChanges(
  eventId: string,
  since: string,
): Promise<SnapshotRpcResult> {
  try {
    const { data, error } = await supabase.rpc('event_changes_since', {
      p_event_id: eventId,
      p_since: since,
    })

    if (error) {
      return isMissingFunction(error)
        ? { ok: false, unsupported: true, message: describe(error) }
        : { ok: false, unsupported: false, message: describe(error) }
    }
    if (data === null || data === undefined) {
      return { ok: false, unsupported: false, message: 'The catch-up came back empty.' }
    }
    return { ok: true, payload: data as RawSnapshot }
  } catch (e) {
    return {
      ok: false,
      unsupported: false,
      message: e instanceof Error ? e.message : 'Could not reach the server.',
    }
  }
}
