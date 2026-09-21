import type { QueryClient, QueryKey } from '@tanstack/react-query'

import { friendlyDbError } from '@/lib/errors'

/**
 * The optimistic write, as a plain function.
 *
 * Deliberately NOT a hook. Everything that makes this correct — patch the cache,
 * fire the write, reconcile or roll back — is ordinary async logic over a
 * `QueryClient`, and keeping it out of React means it can be tested directly
 * with a real client and no DOM. The hook in `useOptimisticAction.ts` is a thin
 * React wrapper around this, so the part that decides whether a user's tap
 * survives is the part that is actually covered by tests.
 */

/** What every action this runs is adapted to. */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; message: string }

export interface OptimisticWriteOptions<TData, TVars, TResult> {
  queryClient: QueryClient
  /** The one cache entry this write affects. V2's event-scoped key. */
  queryKey: QueryKey
  vars: TVars
  /**
   * The optimistic patch. Receives the CURRENT cached value (possibly
   * `undefined` if the screen has not loaded yet) and returns the new one.
   * Must be pure — it can run twice.
   */
  apply: (previous: TData | undefined, vars: TVars) => TData
  /** The server write, adapted to `ActionResult`. */
  action: (vars: TVars) => Promise<ActionResult<TResult>>
  /**
   * Replace the optimistic guess with what the server actually returned.
   * Omit it and the query is invalidated instead, which costs a round trip but
   * is the right default when the server returns a computed shape.
   */
  reconcile?: (server: TResult, optimistic: TData, vars: TVars) => TData
  /** Call-site label for diagnostics. */
  callSite: string
}

export type WriteOutcome =
  | { status: 'ok' }
  | { status: 'rolled-back'; message: string }

/**
 * Apply locally, then reconcile. Returns once the SCREEN has changed, not once
 * the server has answered — the caller shows the result immediately and handles
 * the outcome when it arrives.
 *
 * On failure the cache is restored to exactly what it held before AND the real
 * reason is returned. Both halves matter: a revert with no explanation reads as
 * the app randomly undoing the user's work, which is worse than an honest error
 * the user can act on (docs/INTERACTION-CONTRACT.md T2, T7; UX-RULES R6).
 */
export async function runOptimisticWrite<TData, TVars, TResult>(
  opts: OptimisticWriteOptions<TData, TVars, TResult>,
): Promise<WriteOutcome> {
  const { queryClient, queryKey, vars, apply, action, reconcile } = opts

  // A read already in flight could land AFTER the optimistic patch and clobber
  // it with pre-tap data. Cancel first, then snapshot, then patch.
  await queryClient.cancelQueries({ queryKey })
  const previous = queryClient.getQueryData<TData>(queryKey)

  queryClient.setQueryData<TData>(queryKey, (old) => apply(old as TData | undefined, vars))

  try {
    const result = await action(vars)

    if (!result.ok) {
      // The server said no. Put back exactly what was there — not a guess at
      // what it should be — and tell the truth about why.
      queryClient.setQueryData<TData>(queryKey, previous)
      return { status: 'rolled-back', message: result.message }
    }

    if (reconcile) {
      const optimistic = queryClient.getQueryData<TData>(queryKey)
      queryClient.setQueryData<TData>(queryKey, (old) =>
        reconcile(result.data, (optimistic ?? old) as TData, vars),
      )
    } else {
      // No reconciler: the server's shape is not the cache's shape, so the only
      // safe thing is to re-read it.
      await queryClient.invalidateQueries({ queryKey })
    }

    return { status: 'ok' }
  } catch (e) {
    // A thrown action (transport failure, an unhandled rejection inside it) is
    // the path that used to leave a spinner up forever. It rolls back too.
    queryClient.setQueryData<TData>(queryKey, previous)
    const message = friendlyDbError(
      { message: e instanceof Error ? e.message : String(e) },
      undefined,
      opts.callSite,
    )
    return { status: 'rolled-back', message }
  }
}
