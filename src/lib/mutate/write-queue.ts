import Dexie, { type Table } from 'dexie'

/**
 * Offline queue for reversible writes (V3).
 *
 * Same shape as `src/lib/proof-queue.ts` on purpose — Dexie table, a client
 * `localId` idempotency key, `retries`/`lastError` per row, exponential backoff
 * with a ceiling. A second, differently-shaped queue would be a second thing to
 * debug at 11pm on event eve, so this borrows the shape rather than inventing
 * one.
 *
 * WHAT IS DIFFERENT FROM THE PROOF QUEUE, and why it has to be. A proof is a
 * photo the phone is holding, so the queue owns the payload and `submitProof`
 * runs only when it drains. Here the payload is a few IDs, and the write has
 * ALREADY been applied to the screen optimistically — so a queued entry means
 * "the screen shows this, the server has not been told". That is exactly the
 * state `SyncChip` describes as "waiting to upload", and it must never be
 * described as saved.
 *
 * Replay is by `kind` + `payload`, re-dispatched to the same action the online
 * path used. `localId` is the idempotency key: an action that takes it can treat
 * a duplicate as "already applied" instead of writing twice.
 */

export interface QueuedWrite {
  /** Client UUID — idempotency key for the replay. */
  localId: string
  eventId: string
  /** Which write this is: 'rsvp-outcome', 'room-check-in', 'room-move', ... */
  kind: string
  /** Everything needed to replay it. JSON, because Dexie stores plain rows. */
  payload: string
  /** Shown in the SyncChip vocabulary, e.g. "call outcomes". */
  what: string
  createdAt: number
  retries: number
  lastError: string | null
}

class WriteQueueDb extends Dexie {
  writes!: Table<QueuedWrite, string>

  constructor() {
    super('eventops-write-queue')
    this.version(1).stores({
      writes: 'localId, eventId, kind, createdAt',
    })
  }
}

const db = new WriteQueueDb()

/** Enqueue a write that could not reach the server. */
export async function queueWrite(input: {
  eventId: string
  kind: string
  payload: unknown
  what: string
}): Promise<QueuedWrite> {
  const entry: QueuedWrite = {
    localId: crypto.randomUUID(),
    eventId: input.eventId,
    kind: input.kind,
    payload: JSON.stringify(input.payload),
    what: input.what,
    createdAt: Date.now(),
    retries: 0,
    lastError: null,
  }
  await db.writes.put(entry)
  return entry
}

/** Everything still waiting, oldest first. */
export async function listQueuedWrites(): Promise<QueuedWrite[]> {
  return db.writes.orderBy('createdAt').toArray()
}

/** How many writes are waiting. Drives the SyncChip count. */
export async function queuedWriteCount(): Promise<number> {
  return db.writes.count()
}

/** Record a failed replay attempt. Past the ceiling the row stays for review. */
export async function markWriteFailed(localId: string, message: string): Promise<void> {
  const row = await db.writes.get(localId)
  if (!row) return
  await db.writes.put({ ...row, retries: row.retries + 1, lastError: message })
}

/** Drop a row once the server has accepted it. */
export async function dropQueuedWrite(localId: string): Promise<void> {
  await db.writes.delete(localId)
}

/** Backoff before retry attempt `retries + 1`. Doubles from 2s, capped at 60s. */
export function backoffMs(retries: number): number {
  return Math.min(60_000, Math.pow(2, retries) * 2_000)
}

/** Test-only: empty the queue. IndexedDB persists between vitest cases. */
export async function __clearWriteQueueForTests(): Promise<void> {
  await db.writes.clear()
}
