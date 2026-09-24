'use client'

import { useSyncExternalStore } from 'react'

import { listQueuedCompletions } from '@/lib/call/outbox'
import { drainVoiceNotes } from '@/lib/voice-note/upload'
import { listQueuedVoiceNotes } from '@/lib/voice-note/outbox'
import { flushProofQueue, queuedProofCount } from '@/lib/proof-queue'

import { flushWriteQueue, listQueuedWrites } from './write-queue'

/**
 * The one honest answer to "how many changes is this phone holding?" (M50).
 *
 * WHAT WAS WRONG. The only global, non-dismissible status surface in the app —
 * the offline banner — counted ONE of the four outboxes. A call outcome queued
 * with no signal showed "Offline — 0 changes queued" while the outcome sat in
 * `eventflow-call-outbox`, unsent. The banner did not merely omit the fact, it
 * actively denied it, during a calling shift, which is when the queue is at its
 * fullest. `docs/BUGS.md` M50.
 *
 * WHY A MODULE-LEVEL STORE RATHER THAN A HOOK THAT READS FOUR COUNTS. Because
 * the number has to be readable from places that are not React (the debug
 * screen, a future sync chip) and because four independent `count()` calls in a
 * component's effect re-run on every render that changes identity. Here the
 * refresh is explicit, the subscription is a plain listener set, and React reads
 * it through `useSyncExternalStore`.
 *
 * THE COUNTS COME FROM THE QUEUES, NEVER FROM A SHADOW COUNTER. `snapshot()`
 * re-reads IndexedDB. A cached total would drift the moment a drain succeeded —
 * and a count that drifts UPWARD is precisely how a runner learns to ignore the
 * banner, which is the failure this whole surface exists to prevent.
 */

export interface PendingSummary {
  /** Writes queued by `useOptimisticAction` (rooms, RSVP, check-in). */
  writes: number
  /** Photo proofs waiting to upload. */
  proofs: number
  /** Call completions queued while offline. */
  completions: number
  /** Voice notes held on the phone. */
  voiceNotes: number
  /** The number the banner shows: every queue, not one. */
  total: number
}

/**
 * Where the four counts come from.
 *
 * The seam exists so the sum can be tested without IndexedDB — there is no
 * `fake-indexeddb` in this project and no new dependency belongs in a job whose
 * subject is that the phone is already fast enough. Each reader returns a count
 * OR a list; `count()` below accepts either, because the four queues expose both
 * shapes and normalising them would mean touching four persisted schemas.
 */
export interface PendingReaders {
  writes: () => Promise<unknown>
  proofs: () => Promise<unknown>
  completions: () => Promise<unknown>
  voiceNotes: () => Promise<unknown>
}

const DEFAULT_READERS: PendingReaders = {
  writes: listQueuedWrites,
  proofs: queuedProofCount,
  completions: listQueuedCompletions,
  voiceNotes: listQueuedVoiceNotes,
}

const EMPTY: PendingSummary = {
  writes: 0,
  proofs: 0,
  completions: 0,
  voiceNotes: 0,
  total: 0,
}

let current: PendingSummary = EMPTY
let refreshing: Promise<PendingSummary> | null = null

const listeners = new Set<() => void>()

function publish(next: PendingSummary): void {
  // `useSyncExternalStore` compares with `Object.is`, so a refresh that produced
  // the same numbers must not hand it a new object — that would re-render every
  // subscriber on every 15s tick.
  if (
    next.writes === current.writes &&
    next.proofs === current.proofs &&
    next.completions === current.completions &&
    next.voiceNotes === current.voiceNotes
  ) {
    return
  }
  current = next
  for (const listener of listeners) listener()
}

/**
 * Re-read every queue and publish the total.
 *
 * Concurrent callers share one run: the banner, the debug screen and the
 * interval trigger all call this, and four parallel sets of `count()` calls
 * would be four transactions per queue for one number.
 */
export function refreshPending(readers: PendingReaders = DEFAULT_READERS): Promise<PendingSummary> {
  if (refreshing) return refreshing
  refreshing = readAll(readers).finally(() => {
    refreshing = null
  })
  return refreshing
}

async function readAll(readers: PendingReaders): Promise<PendingSummary> {
  const [writes, proofs, completions, voiceNotes] = await Promise.all([
    count(readers.writes),
    count(readers.proofs),
    count(readers.completions),
    count(readers.voiceNotes),
  ])
  const next: PendingSummary = {
    writes,
    proofs,
    completions,
    voiceNotes,
    total: writes + proofs + completions + voiceNotes,
  }
  publish(next)
  return next
}

/**
 * One queue's count, where a broken queue answers 0 rather than throwing.
 *
 * Private mode and a cleared profile both make IndexedDB unreadable, and neither
 * is a reason for the banner to fail to render. `0` understates a backlog — but
 * a queue that cannot be read is a backlog nothing can drain either, and a crash
 * here would take the banner down with it and hide the other three counts.
 */
async function count(read: () => Promise<unknown>): Promise<number> {
  try {
    const value = await read()
    if (typeof value === 'number') return value
    return Array.isArray(value) ? value.length : 0
  } catch {
    return 0
  }
}

/** The last known summary. Never triggers a read; that is `refreshPending`. */
export function pendingSummary(): PendingSummary {
  return current
}

export function subscribePending(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Server render / pre-hydration: there is no phone storage to read. */
export function serverPendingSummary(): PendingSummary {
  return EMPTY
}

/** React binding. Re-reads on mount; call `refreshPending()` after a write. */
export function usePendingSummary(): PendingSummary {
  return useSyncExternalStore(subscribePending, pendingSummary, serverPendingSummary)
}

/**
 * The proof queue's own count, kept exported because the delivery screen and
 * `/debug` ask a narrower question ("is THIS hamper's photo still on the phone")
 * and should not have to unpack a summary to answer it.
 */
export async function pendingProofCount(): Promise<number> {
  const summary = await refreshPending()
  return summary.proofs
}

/* --------------------------------------------------------------------- */
/* Draining every queue from one trigger                                  */
/* --------------------------------------------------------------------- */

/**
 * Send everything that can be sent right now, then refresh the count.
 *
 * `drainVoiceNotes` is injected rather than imported at module scope by its
 * callers, because it depends on the storage bucket and the Supabase client —
 * both of which a unit test must be able to stand in for.
 */
export interface DrainHooks {
  drainProofs?: () => Promise<unknown>
  drainVoice?: () => Promise<unknown>
  drainCompletions?: () => Promise<unknown>
}

let inFlightDrain: Promise<void> | null = null

export function drainAllQueues(hooks: DrainHooks = {}): Promise<void> {
  if (inFlightDrain) return inFlightDrain
  const run = drainAll(hooks).finally(() => {
    inFlightDrain = null
  })
  inFlightDrain = run
  return run
}

async function drainAll(hooks: DrainHooks): Promise<void> {
  const proofs = hooks.drainProofs ?? flushProofQueue
  const voice = hooks.drainVoice ?? drainVoiceNotes
  const completions = hooks.drainCompletions ?? drainQueuedCompletions

  // The write queue serialises itself internally, so no ordering is needed here.
  await Promise.allSettled([
    flushWriteQueue(),
    proofs(),
    voice(),
    completions(),
  ])
  await refreshPending()
}

/**
 * The default completion drain. Imported lazily inside the function for the same
 * reason `CallScreen` owns the real submit: this module must not import a server
 * action into every bundle that only wants a count.
 */
async function drainQueuedCompletions(): Promise<void> {
  const { submitCallOutcome } = await import('@/lib/actions/call')
  const { drainOutbox } = await import('@/lib/call/outbox')
  await drainOutbox(async (payload) => {
    const result = await submitCallOutcome(payload)
    // `alreadyFinalized` is an `ok: false` branch, not a success branch: the
    // update matched zero rows because the attempt froze — synced from another
    // handset, or closed by a retry that landed after a lost response. Treating
    // it as success is what stops the outbox retrying it forever.
    if (result.ok) return { ok: true }
    return { ok: false, alreadyFinalized: result.alreadyFinalized }
  })
}

/** Test-only: forget the cached summary and any in-flight refresh. */
export function __resetPendingForTests(): void {
  current = EMPTY
  refreshing = null
  inFlightDrain = null
  listeners.clear()
}

/** Test-only: prove the voice-note queue is reachable from the drain. */
export async function __queuedVoiceNoteCountForTests(): Promise<number> {
  return (await listQueuedVoiceNotes()).length
}
