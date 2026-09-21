'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'

import { useOnline } from '@/lib/useOnline'
import { offerUndo } from './undo-store'
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
  /** The server write, adapted to `ActionResult`. */
  action: (vars: TVars) => Promise<ActionResult<TResult>>
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

  // Teach the queue how to replay this kind. Without a registered replay a
  // queued write is never sent — it just sits in IndexedDB while the SyncChip
  // says "waiting to upload", which is the silent loss the queue exists to
  // prevent. Keyed on the kind, not the options object, so it does not re-run
  // on every render.
  useEffect(() => {
    if (!queueKind) return
    registerWriteReplay(queueKind, async (_eventId, payload) => {
      const result = await opts.current.action(payload as TVars)
      return result.ok ? { ok: true } : { ok: false, message: result.message }
    })
  }, [queueKind])

  // Drain on reconnect. Self-contained rather than hung off OfflineBanner: the
  // screens that can queue a write are exactly the screens that use this hook,
  // so wherever a queued write could have come from is also somewhere this runs.
  useEffect(() => {
    if (!online) return
    let alive = true
    void flushWriteQueue()
      .then(() => queuedWriteCount())
      .then((n) => {
        if (alive) setQueuedCount(n)
      })
      .catch(() => {
        // A failed drain is not worth surfacing: the rows are still queued and
        // the next reconnect tries again. Saying "could not send" on every
        // reconnect would train the user to ignore it.
      })
    return () => {
      alive = false
    }
  }, [online])

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
          .then(() => queuedWriteCount())
          .then(setQueuedCount)
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
      }

      const { queryKey, apply, action, reconcile, callSite, message, undo, deferUntilCommit } = o

      void stageOptimisticWrite<TData, TVars, TResult>({
        queryClient,
        queryKey,
        vars,
        apply,
        action,
        reconcile,
        callSite,
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
    [queryClient],
  )

  return { run, syncState, lastError, queuedCount }
}

export default useOptimisticAction
