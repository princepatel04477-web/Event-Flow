'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'

import { useOnline } from '@/lib/useOnline'
import { offerUndo } from './undo-store'
import { runOptimisticWrite, type ActionResult } from './optimistic'
import { queuedWriteCount, queueWrite } from './write-queue'

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
 * WHAT IT RETURNS. `syncState` is the SyncChip vocabulary applied to a single
 * write: `sending` / `saved` / `queued` / `failed`. `queuedCount` is how many
 * writes are waiting, which is what `SyncChip` renders.
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
   * The reverse write. OMIT IF NO REVERSE EXISTS — an Undo that cannot undo is
   * worse than no Undo, because the user believes their mistake is recoverable.
   */
  undo?: (vars: TVars) => Promise<ActionResult<unknown>>
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

  useEffect(() => {
    if (!options.queue) return
    let alive = true
    void queuedWriteCount().then((n) => {
      if (alive) setQueuedCount(n)
    })
    return () => {
      alive = false
    }
  }, [options.queue])

  const run = useCallback(
    (vars: TVars) => {
      const o = opts.current
      setLastError(null)
      setSyncState('sending')

      if (!online) {
        if (!o.queue) {
          setSyncState('failed')
          setLastError('You are offline. Try again when you have signal.')
          return
        }
        // The screen still changes: that is the promise T7 makes. What it must
        // NOT do is call this saved — SyncChip reports it as waiting instead.
        queryClient.setQueryData(o.queryKey, (old) =>
          o.apply(old as TData | undefined, vars),
        )
        setSyncState('queued')
        void queueWrite({
          eventId: o.queue.eventId,
          kind: o.queue.kind,
          payload: vars,
          what: o.queue.what,
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
        return
      }

      const { queryKey, apply, action, reconcile, callSite, message, undo } = o

      void runOptimisticWrite<TData, TVars, TResult>({
        queryClient,
        queryKey,
        vars,
        apply,
        action,
        reconcile,
        callSite,
      }).then((outcome) => {
        if (outcome.status === 'ok') {
          setSyncState('saved')
          if (undo) {
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
        } else {
          setSyncState('failed')
          setLastError(outcome.message)
        }
      })
    },
    [online, queryClient],
  )

  return { run, syncState, lastError, queuedCount }
}

export default useOptimisticAction
