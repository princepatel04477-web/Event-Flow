import type { QueryClient, QueryKey } from '@tanstack/react-query'

import { friendlyDbError, isNetworkError } from '@/lib/errors'

/**
 * The optimistic write, as plain functions over a `QueryClient`.
 *
 * Deliberately NOT hooks. Everything that makes this correct — patch the cache,
 * fire the write, reconcile or roll back — is ordinary async logic, and keeping
 * it out of React means it can be tested directly with a real client and no DOM.
 * The hook in `useOptimisticAction.ts` is a thin wrapper, so the part that
 * decides whether a user's tap survives is the part actually covered by tests.
 *
 * TWO MODES, and which one a write uses is a real decision:
 *
 *   IMMEDIATE (`runOptimisticWrite`) — patch, send at once, undo by sending a
 *   REVERSE write. Correct only where a reverse action genuinely exists. The
 *   write is durable from the moment it is sent, which is what you want on a
 *   phone that can die.
 *
 *   DEFERRED (`stageOptimisticWrite` + `send`/`revert`) — patch now, hold the
 *   server write until the undo window closes. Undo restores the cache and
 *   NOTHING IS SENT, so no reverse action is needed and the undo is real rather
 *   than a compensating write that lands on a different wrong state.
 *
 * The second mode exists because most of this app's writes have no reverse:
 * `check_in_room` and `check_out_room` only move forward and never clear a
 * timestamp, and there is no vehicle-unassign action at all. V10 names this
 * choice for exactly that case — "either the outcome commits on a delay with a
 * real undo window before the write fires, or it commits immediately and the
 * screen says it is final". Deferring is the first of those.
 *
 * THE COST OF DEFERRING, stated plainly: a write the app dies before flushing
 * never happened. On a phone that can be closed mid-shift that is a real risk,
 * so deferral is chosen per write and never applied by default.
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
  /**
   * Per-attempt context that is NOT part of the payload.
   *
   * `localId` is the outbox row's idempotency key (B8). It travels beside the
   * variables rather than inside them because an action's variables are
   * schema-validated on arrival, and a key merged into a payload that zod strips
   * is a key the action never sees — which is the bug this argument exists to
   * fix, not a way to fix it.
   */
  action: (
    vars: TVars,
    context?: { localId?: string },
  ) => Promise<ActionResult<TResult>>
  /**
   * Replace the optimistic guess with what the server actually returned.
   * Omit it and the query is invalidated instead, which costs a round trip but
   * is the right default when the server returns a computed shape.
   */
  reconcile?: (server: TResult, optimistic: TData, vars: TVars) => TData
  /** Call-site label for diagnostics. */
  callSite: string
  /**
   * Leave the optimistic patch in place when the failure was the NETWORK, so a
   * caller that queues the write does not first flash the row back to its old
   * value and then forward again.
   *
   * Only the transport path honours this. A failure the server actually returned
   * (`{ok: false}`) is a decision, not a hiccup — retrying it would fail
   * identically, so it always rolls back.
   */
  holdOnNetworkFailure?: boolean
  /**
   * Patch the EVENT STORE instead of the query cache.
   *
   * WHY THIS IS A FIELD RATHER THAN A SECOND HOOK. The orchestration around a
   * write — defer the send for an undo window, queue on a transport failure,
   * report the refusal, offer the reverse — is identical whichever local copy
   * of the data is patched. Forking the hook would mean two copies of that
   * logic, and the one that is not exercised on the day is the one that is
   * wrong. So the *target* is injected and everything else is shared.
   *
   * The callbacks are lazy because the patch has to be applied AFTER the caller
   * has had a chance to capture the un-patched state, and `revert` must undo
   * exactly the ops that were applied (see `src/lib/store/reducer.ts`
   * `invertOps`). `refresh` is the store's equivalent of the query
   * invalidation `settle` already performs: a background catch-up, never a wait.
   *
   * `reconcile` is IGNORED when this is present. It patches the query cache,
   * which nothing renders in store mode; the catch-up is authoritative and
   * arrives on the same connection.
   */
  storeTarget?: {
    apply: (vars: TVars) => void
    revert: () => void
    refresh: () => void
  }
}

export type WriteOutcome =
  | { status: 'ok' }
  | {
      status: 'rolled-back'
      message: string
      /**
       * True when the failure was the transport, not the database. The caller
       * uses this to decide whether the write is worth queueing: a logical
       * refusal (permission, constraint) would fail identically on replay, so
       * queueing it would just produce a permanently stuck row.
       */
      network: boolean
    }

/** A staged write: the screen has already changed, the server has not been told. */
export interface StagedWrite {
  /** Send it and settle. Safe to call more than once; only the first sends. */
  send: () => Promise<WriteOutcome>
  /** Put the cache back to exactly what it held before the patch. */
  revert: () => void
}

/**
 * Fire the action and settle the cache against what comes back.
 *
 * On failure the cache is restored to exactly what it held before AND the real
 * reason is returned. Both halves matter: a revert with no explanation reads as
 * the app randomly undoing the user's work, which is worse than an honest error
 * they can act on (docs/INTERACTION-CONTRACT.md T2, T7; UX-RULES R6).
 */
async function settle<TData, TVars, TResult>(
  opts: OptimisticWriteOptions<TData, TVars, TResult>,
  previous: TData | undefined,
): Promise<WriteOutcome> {
  const { queryClient, queryKey, vars, action, reconcile, storeTarget } = opts

  // STORE MODE. Same three outcomes as below — refused, rolled back, accepted —
  // against the event store rather than a cache entry. `previous` is unused
  // here on purpose: the store's undo is the inverted op list the caller
  // staged, which undoes only the rows this write touched (see
  // `src/lib/store/reducer.ts`).
  if (storeTarget) {
    try {
      const result = await action(vars)
      if (!result.ok) {
        storeTarget.revert()
        storeTarget.refresh()
        return { status: 'rolled-back', message: result.message, network: false }
      }
      // Always refresh, even though the screen already looks right. The RPC
      // writes more than the fields the caller guessed at — `check_in_room`
      // picks the family's OLDEST unrealised assignment, `mark_arrived` stamps
      // every arrival leg — so the phone's guess can be right about the row
      // that was tapped and wrong about its siblings.
      storeTarget.refresh()
      return { status: 'ok' }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      const network = isNetworkError({ message })
      if (!(network && opts.holdOnNetworkFailure)) storeTarget.revert()
      // Refresh either way: an inversion is a reconstruction of old values,
      // and only the server can say what the row actually holds now.
      storeTarget.refresh()
      return {
        status: 'rolled-back',
        message: friendlyDbError({ message }, undefined, opts.callSite),
        network,
      }
    }
  }

  try {
    const result = await action(vars)

    if (!result.ok) {
      // The server said no. Put back exactly what was there — not a guess at
      // what it should be — and tell the truth about why. `network: false`
      // because a server decision is not worth queueing.
      queryClient.setQueryData<TData>(queryKey, previous)
      void queryClient.invalidateQueries({ queryKey })
      return { status: 'rolled-back', message: result.message, network: false }
    }

    if (reconcile) {
      const optimistic = queryClient.getQueryData<TData>(queryKey)
      queryClient.setQueryData<TData>(queryKey, (old) =>
        reconcile(result.data, (optimistic ?? old) as TData, vars),
      )
    }

    // ALWAYS re-read, even when a reconciler produced a good guess. The guess
    // can only patch the rows the caller knows about, and several of these
    // writes touch more than that: `check_in_room` picks a family's OLDEST
    // unrealised assignment rather than the row that was tapped, and
    // `check_out_room` clears ALL of them, while `mark_arrived` updates every
    // arrival leg. A reconciler keyed on one id therefore leaves sibling rows
    // asserting phone-clock state the database never accepted — and on the
    // check-in board that same stale row feeds `occupiedByOther`, so the room
    // shows as taken and the double-booking guard stops protecting it.
    //
    // This is the round trip the pre-V3 code always paid (`await reload()`).
    // The screen has already changed, so it is a BACKGROUND re-read, not a wait.
    await queryClient.invalidateQueries({ queryKey })

    return { status: 'ok' }
  } catch (e) {
    // A thrown action (transport failure, an unhandled rejection inside it) is
    // the path that used to leave a spinner up forever.
    const message = e instanceof Error ? e.message : String(e)
    const network = isNetworkError({ message })

    if (!(network && opts.holdOnNetworkFailure)) {
      queryClient.setQueryData<TData>(queryKey, previous)
    }
    // Re-read either way. A snapshot restore is a guess that also clobbers any
    // OTHER optimistic patch made since — a second tap on a different row. The
    // refetch is what actually makes the screen agree with the server.
    void queryClient.invalidateQueries({ queryKey })

    return {
      status: 'rolled-back',
      message: friendlyDbError({ message }, undefined, opts.callSite),
      network,
    }
  }
}

/**
 * Patch the cache now and hand back the two things a caller can do with it.
 *
 * Split from `send` so a caller can hold the write open while an undo window
 * runs. Everything before this point is synchronous from the screen's point of
 * view once the returned promise settles — the tap has already taken effect.
 */
export async function stageOptimisticWrite<TData, TVars, TResult>(
  opts: OptimisticWriteOptions<TData, TVars, TResult>,
): Promise<StagedWrite> {
  const { queryClient, queryKey, vars, apply, storeTarget } = opts

  // STORE MODE: the patch goes to the event store, and the "previous" value to
  // restore is the inverted op list the store hands back. Nothing here touches
  // the query cache — in store mode there is no observer on `queryKey`, so a
  // cancel/snapshot/restore would be three no-ops and one lie.
  if (storeTarget) {
    storeTarget.apply(vars)
    let sent = false
    return {
      revert: () => {
        if (sent) return
        storeTarget.revert()
      },
      send: async () => {
        if (sent) return { status: 'ok' }
        sent = true
        return settle(opts, undefined)
      },
    }
  }

  // A read already in flight could land AFTER the optimistic patch and clobber
  // it with pre-tap data. Cancel first, then snapshot, then patch.
  await queryClient.cancelQueries({ queryKey })
  const previous = queryClient.getQueryData<TData>(queryKey)

  queryClient.setQueryData<TData>(queryKey, (old) => apply(old as TData | undefined, vars))

  let sent = false

  return {
    revert: () => {
      // REFUSE once the write has been sent. The server has already been told to
      // change this, so putting the pre-tap value back would leave the screen
      // asserting something that is no longer true, with nothing to correct it —
      // reversing the write is the server's job now, not the cache's.
      //
      // Not reachable through today's hook (the undo store clears the entry
      // before running either callback, so a staged write can only commit or
      // undo, never both), but the guard costs nothing and the bug it prevents
      // is silent.
      if (sent) return
      queryClient.setQueryData<TData>(queryKey, previous)
    },
    send: async () => {
      // Sent twice would be two server writes for one tap on a forward-only
      // RPC. The undo window expiring and a displaced undo can both fire.
      if (sent) return { status: 'ok' }
      sent = true
      return settle(opts, previous)
    },
  }
}

/**
 * Patch, send at once, and expect a REVERSE write if the user presses Undo.
 *
 * Use this only where a genuine reverse exists. For forward-only state use
 * `stageOptimisticWrite` and hold the send until the undo window closes.
 */
export async function runOptimisticWrite<TData, TVars, TResult>(
  opts: OptimisticWriteOptions<TData, TVars, TResult>,
): Promise<WriteOutcome> {
  const staged = await stageOptimisticWrite(opts)
  return staged.send()
}
