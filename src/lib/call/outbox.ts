/**
 * IndexedDB outbox for call completions made while offline.
 *
 * Venue Wi-Fi will fail. If the network is down when the caller submits an
 * outcome, we do not pretend the write succeeded — we store the completion
 * here, keyed by `attemptId` (so retrying never double-queues the same
 * completion), and drain it the moment the browser reports it is back
 * online. The UI is responsible for showing the pending state honestly.
 */
'use client'

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

import { isAttemptedDue } from '@/lib/outbox/schedule'

import type { CallCompletionPayload } from './types'

const DB_NAME = 'eventflow-call-outbox'
const DB_VERSION = 1
const STORE = 'pending-completions'

export interface QueuedCompletion {
  payload: CallCompletionPayload
  queuedAt: string // ISO, for display ("saved 4m ago")
  attempts: number // drain attempts so far, for basic backoff/debugging
}

interface OutboxDb extends DBSchema {
  [STORE]: {
    key: string // attemptId
    value: QueuedCompletion
  }
}

let dbPromise: Promise<IDBPDatabase<OutboxDb>> | null = null

function getDb(): Promise<IDBPDatabase<OutboxDb>> {
  if (!dbPromise) {
    dbPromise = openDB<OutboxDb>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'payload.attemptId' })
        }
      },
    })
  }
  return dbPromise
}

/** Queue a completion for later sync. Overwrites any earlier queue entry for the same attempt. */
export async function queueCompletion(payload: CallCompletionPayload): Promise<void> {
  const db = await getDb()
  await db.put(STORE, {
    payload,
    queuedAt: new Date().toISOString(),
    attempts: 0,
  })
}

export async function listQueuedCompletions(): Promise<QueuedCompletion[]> {
  const db = await getDb()
  return db.getAll(STORE)
}

export async function getQueuedCompletion(attemptId: string): Promise<QueuedCompletion | undefined> {
  const db = await getDb()
  return db.get(STORE, attemptId)
}

export async function removeQueuedCompletion(attemptId: string): Promise<void> {
  const db = await getDb()
  await db.delete(STORE, attemptId)
}

export async function bumpQueuedAttempt(attemptId: string): Promise<void> {
  const db = await getDb()
  const existing = await db.get(STORE, attemptId)
  if (!existing) return
  await db.put(STORE, { ...existing, attempts: existing.attempts + 1 })
}

/**
 * Drain every queued completion using `submit`. Each item is removed only on
 * success, or on a definitive "already finalized" response — a row that
 * froze because it synced from another tab/device is not an error, it is
 * exactly what we wanted. Anything else is left queued for the next drain.
 *
 * THE BACKOFF IS REAL NOW (M24). `attempts` was incremented by
 * `bumpQueuedAttempt` on every failure and read by NOTHING — the comment called
 * it "for basic backoff/debugging" and the debugging half was the only half
 * that existed. Combined with a trigger that was mount plus the `online` event,
 * a completion queued on associated-but-dead Wi-Fi (where `online` never fires)
 * waited for the next full app launch. Each row is now skipped until its own
 * backoff window has passed, and the queue as a whole is driven by the shared
 * `scheduleDrain` in `src/lib/outbox/schedule.ts`.
 */
export async function drainOutbox(
  submit: (payload: CallCompletionPayload) => Promise<{ ok: boolean; alreadyFinalized?: boolean }>,
): Promise<{ synced: string[]; stillQueued: string[] }> {
  const items = await listQueuedCompletions()
  const synced: string[] = []
  const stillQueued: string[] = []

  for (const item of items) {
    // Still inside its backoff window: leave it completely alone. Counting this
    // as an attempt would double-count and push the row past the "needs
    // attention" ceiling for a retry that never happened.
    if (!isAttemptedDue(item)) {
      stillQueued.push(item.payload.attemptId)
      continue
    }

    try {
      const result = await submit(item.payload)
      if (result.ok || result.alreadyFinalized) {
        await removeQueuedCompletion(item.payload.attemptId)
        synced.push(item.payload.attemptId)
      } else {
        await bumpQueuedAttempt(item.payload.attemptId)
        stillQueued.push(item.payload.attemptId)
      }
    } catch {
      await bumpQueuedAttempt(item.payload.attemptId)
      stillQueued.push(item.payload.attemptId)
    }
  }

  return { synced, stillQueued }
}
