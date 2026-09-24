'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'

import { useEventStore, useEventStoreEngine } from '@/lib/store/useEventStore'
import type { EventState, StoreOp } from '@/lib/store/types'
import { scheduleDrain } from '@/lib/outbox/schedule'
import { useOnline } from '@/lib/useOnline'
import { offerUndo, reportFailedWrite } from './undo-store'
import { refreshPending } from './pending'
import { stageOptimisticWrite, type ActionResult, type WriteOutcome } from './optimistic'
import { queuedWriteCount, flushWriteQueue, queueWrite, registerWriteReplay } from './write-queue'

/**
 * The one hook every reversible write goes through.
 *
 * WHY ONE HOOK. There were 23 hand-rolled `saving` flags before this. Each one
 * blocked its own control for the length of a round trip to Seoul, and each one
 * was a slightly different bug. A shared hook is not tidiness — it is the only
 * way the contract below is true everywhere instead of true where someone
 * remembered it:
 *
 *   T1  the screen changes on the tap, from local state, with no await in front
 *   T2  the write is reconciled (or corrected) after the fact, never silently
 *   T3  nothing is disabled while the write is in flight
 *   T7  a write is reported as saved, waiting, or failed — never ambiguously
 *
 * TWO WAYS TO BE UNDOABLE, and the choice is per write:
 *
 *   `undo` given          — the write is sent immediately and Undo sends the
 *                           reverse. Only correct where a reverse genuinely
 *                           exists (see the DECISIONS entry for the audit).
 *   `deferUntilCommit`    — the write is held until the undo window closes, so
 *                           Undo means NOTHING WAS SENT. This is the honest undo
 *                           for forward-only state, where the "reverse" would
 *                           land on a different wrong state.
 *
 * Give neither and the write is simply optimistic-with-rollback, with no Undo
 * offered — which is the right answer for a write that is genuinely one-way and
 * where holding it open would be worse than committing it.
 *
 * NOT FOR IRREVERSIBLE WRITES. Sealing a delivery proof must NOT go through
 * this: `delivery_proofs` is insert-only with `app.block_mutation()` triggers, so
 * there is no rollback and no undo, and showing one would be a lie the database
 * cannot honour (CLAUDE.md §5.2). That path keeps its confirmation and its
 * `loading` button.
 */

export type WriteSyncState = 'idle' | 'sending' | 'saved' | 'queued' | 'failed'

export interface UseOptimisticActionOptions<TData, TVars, TResult> {
  /** The cache entry this write changes. Must be a V2 event-scoped key. */
  queryKey: QueryKey
  /** The optimistic patch, applied to the cached value. */
  apply: (previous: TData | undefined, vars: TVars) => TData
  /**
   * The server write, adapted to `ActionResult`.
   *
   * `context.localId` is the outbox row's idempotency key, supplied ONLY on a
   * replay (B8). An action that can honour it treats a duplicate as already
   * applied; an action that ignores it behaves exactly as before, which is why
   * this is an optional second argument rather than a change to `TVars`.
   */
  action: (
    vars: TVars,
    context?: { localId?: string },
  ) => Promise<ActionResult<TResult>>
  /** Replace the guess with the server's answer. Omit to invalidate instead. */
  reconcile?: (server: TResult, optimistic: TData, vars: TVars) => TData
  callSite: string
  /** What the UndoBar says: "Sharma family · Confirmed". */
  message: (vars: TVars) => string
  /**
   * The reverse write, for state that genuinely has one. OMIT IF IT DOES NOT —
   * an Undo that cannot undo is worse than no Undo, because the user believes
   * their mistake is recoverable.
   */
  undo?: (vars: TVars) => Promise<ActionResult<unknown>>
  /**
   * Hold the server write until the undo window closes, so Undo cancels it
   * entirely. Use instead of `undo` for forward-only state.
   *
   * The cost is real and belongs to the write, not to this hook: a write the app
   * dies before flushing never happened.
   */
  deferUntilCommit?: boolean
  /** Offline queue metadata. Omit to fail rather than queue when offline. */
  queue?: { eventId: string; kind: string; what: string }
  /**
   * The same patch, expressed as ops on the local event store.
   *
   * WHEN PRESENT AND THE STORE IS LIVE, THE QUERY CACHE IS NOT TOUCHED AT ALL.
   * The store is what the screens read (`src/lib/store`), so patching a cache
   * entry nobody observes would leave the screen unchanged and the write
   * invisible until the next catch-up — the exact "tap does nothing" failure
   * the optimistic layer exists to prevent. The `apply` above is kept as the
   * FALLBACK path's patch, which is what makes this deployable before the
   * `event_snapshot` migration exists: with no store, this option is never
   * consulted and the hook behaves exactly as it did.
   *
   * `ops` RECEIVES THE CURRENT STATE, because most of these writes cannot be
   * expressed without it: "place three of this family's guests" has to know
   * which guests are not yet placed, and the answer is in the store, not in the
   * variables. Reading it from the engine (rather than closing over a stale
   * render) is also what keeps two fast taps on the same family coherent.
   *
   * `eventId` is carried for the same reason `queue.eventId` is: an op list
   * built from a screen bound to one event must never be applied to another.
   */
  store?: { eventId: string; ops: (vars: TVars, state: EventState) => StoreOp[] }
}

export interface UseOptimisticActionResult<TVars> {
  /** Call from the tap handler. Returns immediately; the screen has changed. */
  run: (vars: TVars) => void
  syncState: WriteSyncState
  /** The real reason the last write failed, in the house error voice. */
  lastError: string | null
  /** Writes waiting for a connection — feed to SyncChip's `count`. */
  queuedCount: number
}

export function useOptimisticAction<TData, TVars, TResult>(
  options: UseOptimisticActionOptions<TData, TVars, TResult>,
): UseOptimisticActionResult<TVars> {
  const queryClient = useQueryClient()
  const online = useOnline()

  // The store, when this screen is inside an `EventStoreProvider` AND the
  // snapshot RPC answered. Outside the provider (the v1 tree, and every test
  // that does not mount one) both are null/'loading' and this hook is exactly
  // what it was.
  const engine = useEventStoreEngine()
  const storeMode = useEventStore((state) => state.mode)

  const storeRef = useRef({ engine, mode: storeMode })
  useEffect(() => {
    storeRef.current = { engine, mode: storeMode }
  })

  const [syncState, setSyncState] = useState<WriteSyncState>('idle')
  const [lastError, setLastError] = useState<string | null>(null)
  const [queuedCount, setQueuedCount] = useState(0)

  // Callers pass an inline options object, so its identity changes every render.
  // Holding the latest one in a ref keeps `run` stable across renders —
  // otherwise every keystroke elsewhere on the screen would hand the child a new
  // callback.
  //
  // Written in an effect, not during render: mutating a ref while rendering is
  // exactly what `react-hooks/refs` forbids, and it is right to — the value
  // would be read by an event handler that fires after paint anyway.
  const opts = useRef(options)
  useEffect(() => {
    opts.current = options
  })

  // The undo window can outlive this render by seven seconds, so a callback that
  // captured `online` would decide whether to queue based on a stale value. Read
  // it live instead.
  const onlineRef = useRef(online)
  useEffect(() => {
    onlineRef.current = online
  })

  // A write can be in flight, or waiting out its undo window, when the screen
  // that armed it unmounts. `report` below writes to this component's state, and
  // a message written to an unmounted component is rendered by nobody — which
  // made a server refusal silent. The module store can still be seen, so the
  // failure is routed there when this is no longer mounted. See `undo-store.ts`.
  const mountedRef = useRef(true)
  useEffect(
    () => () => {
      mountedRef.current = false
    },
    [],
  )

  useEffect(() => {
    // Depends on the KIND (a string), not the options object: callers pass an
    // inline literal, so an object dependency re-runs this after EVERY render and
    // issues an IndexedDB count per render per hook — on the check-in screen that
    // is twice per keystroke in its search box, for a number nothing was even
    // rendering.
    if (!options.queue?.kind) return
    let alive = true
    void queuedWriteCount().then((n) => {
      if (alive) setQueuedCount(n)
    })
    return () => {
      alive = false
    }
  }, [options.queue?.kind])

  const queueKind = options.queue?.kind
  const queueEventId = options.queue?.eventId

  useEffect(() => {
    // Depends on the KIND (a string), not the options object: callers pass an
    // inline literal, so an object dependency re-runs this after EVERY render and
    // issues an IndexedDB count per render per hook — on the check-in screen that
    // is twice per keystroke in its search box, for a number nothing was even
    // rendering.
    //
    // THE COUNT IS NARROWED TO THIS HOOK'S KIND AND EVENT (M49). It used to be
    // the whole queue, so `RoomsBoard` — which mounts four hooks and adds their
    // counts — rendered "4 room changes are saved on this phone" after one
    // change, and `CheckInClient` rendered "(2 waiting)" for one check-in. The
    // global total is not a lie anywhere; it is just not THIS screen's number.
    if (!queueKind) return
    let alive = true
    void queuedWriteCount({ kind: queueKind, eventId: queueEventId }).then((n) => {
      if (alive) setQueuedCount(n)
    })
    return () => {
      alive = false
    }
  }, [queueKind, queueEventId])

  const countQueued = useCallback(async (): Promise<number> => {
    if (!queueKind) return 0
    return queuedWriteCount({ kind: queueKind, eventId: queueEventId })
  }, [queueKind, queueEventId])

  // Teach the queue how to replay this kind. Without a registered replay a
  // queued write is never sent — it just sits in IndexedDB while the SyncChip
  // says "waiting to upload", which is the silent loss the queue exists to
  // prevent. Keyed on the kind, not the options object, so it does not re-run
  // on every render.
  useEffect(() => {
    if (!queueKind) return
    registerWriteReplay(queueKind, async (eventId, payload, localId) => {
      // The action closes over the MOUNTED screen's event, so replaying a row
      // from a different event would write it into whichever event happens to be
      // open — a cross-tenant write, and the same class of bug the event-scoped
      // cache keys exist to prevent. Leave it queued instead; it replays when its
      // own event is open again.
      //
      // `defer`, not a failure: the row is valid, it is just not this event's
      // turn. Counting a retry would push it toward the stuck list for nothing.
      if (opts.current.queue?.eventId !== eventId) {
        return { ok: false, message: 'queued for another event', defer: true }
      }
      // `localId` is now THREADED THROUGH (B8), in the CONTEXT argument rather
      // than merged into the payload. It is the row's idempotency key and it used
      // to be documented as one while being passed to nothing, so a replay that
      // ran twice placed two different sets of a family's guests.
      // `flushWriteQueue` serialises its own drain, which prevents the ordinary
      // double-flush; this is the second line of defence for an action that can
      // honour a key. It is a separate argument because the payload is validated
      // by a zod schema on the way in (`commitFamilySchema` and friends), and an
      // extra key inside it would be stripped or rejected — a key that the action
      // never sees is the same bug it was meant to fix.
      const result = await opts.current.action(payload as TVars, { localId })
      return result.ok ? { ok: true } : { ok: false, message: result.message }
    })
  }, [queueKind])

  // Drain on reconnect. Self-contained rather than hung off OfflineBanner: the
  // screens that can queue a write are exactly the screens that use this hook,
  // so wherever a queued write could have come from is also somewhere this runs.
  //
  // THE TRIGGERS COME FROM THE SHARED SCHEDULE (M24). Mount, `online`, and
  // `visibilitychange` were already here — this hook was the one queue that had
  // been fixed for the associated-but-dead case. The shared `scheduleDrain` adds
  // the interval that the OTHER three queues were missing, so all four are
  // retried on the same moments rather than only the one whose screen happens to
  // be mounted.
  useEffect(() => {
    let alive = true

    const drain = () => {
      void flushWriteQueue()
        .then(() => countQueued())
        .then((n) => {
          if (alive) setQueuedCount(n)
        })
        .catch(() => {
          // A failed drain is not worth surfacing: the rows are still queued and
          // the next attempt tries again. Saying "could not send" every time
          // would train the user to ignore it.
        })
    }

    const stop = scheduleDrain(drain)

    return () => {
      alive = false
      stop()
    }
    // `online` is not a dependency: `scheduleDrain` reads `navigator.onLine`
    // itself and installs the `online` listener, so re-running this effect on a
    // connectivity flip would tear down and rebuild the timer for no reason.
  }, [countQueued])

  const run = useCallback(
    (vars: TVars) => {
      const o = opts.current
      setLastError(null)
      setSyncState('sending')

      const meta = o.queue

      const queueInstead = () => {
        if (!meta) {
          setSyncState('failed')
          setLastError('You are offline. Try again when you have signal.')
          return
        }
        setSyncState('queued')
        void queueWrite({
          eventId: meta.eventId,
          kind: meta.kind,
          payload: vars,
          what: meta.what,
        })
          .then(() => countQueued())
          .then((n) => {
            setQueuedCount(n)
            // The global banner reads the shared store, and it has no way to know
            // a row just landed in this hook's queue — it is not subscribed to
            // IndexedDB, only to its own summary. Without this nudge the banner
            // would say "0 changes queued" until its next 15s tick, which is the
            // M50 complaint again with a narrower window.
            void refreshPending()
          })
          .catch((e: unknown) => {
            // IndexedDB full or blocked (private mode). Say so rather than
            // leaving the write looking merely queued when nothing was stored.
            setSyncState('failed')
            setLastError(
              e instanceof Error
                ? `Could not save that on this phone: ${e.message}`
                : 'Could not save that on this phone.',
            )
          })
      }

      const report = (outcome: WriteOutcome) => {
        if (outcome.status === 'ok') {
          setSyncState('saved')
          return
        }
        // A TRANSPORT failure is the venue's actual failure mode, and it does not
        // look like being offline: the Wi-Fi is associated and carrying nothing,
        // so `navigator.onLine` is true and the request fails anyway. Queue it
        // rather than throwing the write away — CLAUDE.md §11b says the venue link
        // will do exactly this, and `holdOnNetworkFailure` has already left the
        // row showing what the user set.
        //
        // A failure the SERVER returned is a decision, not a hiccup: replaying it
        // would fail identically, so it must not enter the queue.
        if (outcome.network && meta) {
          queueInstead()
          return
        }
        setSyncState('failed')
        setLastError(outcome.message)

        // ...and if this screen is already gone, the two lines above reached
        // nobody. The write was committed on the user's behalf by a timer they
        // armed and walked away from, so its refusal has to be visible somewhere
        // that still exists. UndoBar renders this.
        if (!mountedRef.current) reportFailedWrite(outcome.message)
      }

      const { queryKey, apply, action, reconcile, callSite, message, undo, deferUntilCommit } = o

      // The store target, if this write has one and the store is live. Built
      // here rather than in the caller so the store's event id is checked
      // against the screen's in one place.
      const live = storeRef.current
      const storeTarget =
        live.mode === 'store' &&
        live.engine !== null &&
        o.store !== undefined &&
        o.store.eventId === live.engine.eventId
          ? (() => {
              const liveEngine = live.engine
              const buildOps = o.store.ops
              let staged: { revert: () => void } | null = null
              return {
                apply: (vars: TVars) => {
                  staged = liveEngine.stage(buildOps(vars, liveEngine.getState()))
                },
                revert: () => staged?.revert(),
                // A background catch-up, never a wait: the row is already on
                // screen and the server's answer corrects the guess.
                refresh: () => {
                  void liveEngine.catchUp()
                },
              }
            })()
          : undefined

      void stageOptimisticWrite<TData, TVars, TResult>({
        queryClient,
        queryKey,
        vars,
        apply,
        action,
        reconcile,
        callSite,
        storeTarget,
        // The caller can queue, so a network failure should leave the row as the
        // user set it rather than flashing it back and then forward again.
        holdOnNetworkFailure: Boolean(meta),
      }).then((staged) => {
        if (!onlineRef.current) {
          // KEEP the patch. The screen changes on the tap (T1) and the write is
          // reported as waiting, never as saved (T7/R8).
          //
          // This branch used to call `staged.revert()` first, which made an
          // offline tap a silent no-op: the row snapped straight back, nothing
          // said why, and the runner tapped again — queueing a second copy of a
          // write that was already queued.
          queueInstead()
          return
        }

        if (deferUntilCommit) {
          // Nothing is sent yet, so Undo is real: it cancels a write that never
          // happened, rather than compensating for one that did.
          offerUndo({
            message: message(vars),
            commit: () => {
              if (!onlineRef.current) {
                queueInstead()
                return
              }
              void staged.send().then(report)
            },
            undo: () => {
              staged.revert()
              setSyncState('idle')
            },
          })
          return
        }

        void staged.send().then((outcome) => {
          report(outcome)
          if (outcome.status === 'ok' && undo) {
            offerUndo({
              message: message(vars),
              // The write already stands, so "keep" has nothing to do — the
              // window expiring IS the confirmation.
              commit: () => {},
              undo: () => {
                void undo(vars).then(async (result) => {
                  if (!result.ok) {
                    setSyncState('failed')
                    setLastError(result.message)
                    return
                  }
                  // Whatever the reverse did, re-read so the screen shows the
                  // server's truth rather than our guess at it.
                  await queryClient.invalidateQueries({ queryKey })
                  setSyncState('idle')
                })
              },
            })
          }
        })
      })
    },
    // `countQueued` is stable for a given kind+event, and it is what makes the
    // number this hook reports ITS OWN queue rather than the whole phone's (M49).
    // It was reading the whole queue before, which is why `RoomsBoard` rendered
    // four times its own backlog.
    [queryClient, countQueued],
  )

  return { run, syncState, lastError, queuedCount }
}

export default useOptimisticAction
