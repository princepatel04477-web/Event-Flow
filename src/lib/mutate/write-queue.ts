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

/** How many attempts before a write is surfaced as needing attention. */
export const STUCK_AFTER_RETRIES = 5

/**
 * How to replay a queued write, by `kind`.
 *
 * A paid-for lesson from the shape of this queue: a queue with no replay path is
 * not a queue, it is a place writes go to die. The first version of this file had
 * `queueWrite` and no `flush`, so the hook reported a write as "queued" and
 * nothing ever sent it — the exact silent loss the whole feature exists to
 * prevent.
 *
 * A registry rather than a switch statement, so this module stays generic and
 * does not have to import every action that might be queued. Each screen
 * registers its own kind when it mounts.
 */
export type WriteReplay = (
  eventId: string,
  payload: unknown,
) => Promise<
  | { ok: true }
  | {
      ok: false
      message: string
      /**
       * "Not now, leave it queued" — as opposed to "this failed".
       *
       * ONE ROW MUST NOT BE REPLAYED INTO THE WRONG EVENT. A replay closes over
       * the action of whichever screen is currently mounted, and that action is
       * bound to that screen's event. So a row queued for event A while event B
       * is open would be written into B — a cross-tenant write, and the same
       * class of bug the event-scoped cache keys exist to prevent.
       *
       * A deferred row is SKIPPED, not failed: it is still perfectly valid, it is
       * simply waiting for its own event to be open. Counting a retry against it
       * would eventually push it into the "stuck" list for no reason.
       */
      defer?: boolean
    }
>

const replays = new Map<string, WriteReplay>()

/** Register how to replay one kind of queued write. Idempotent per kind. */
export function registerWriteReplay(kind: string, replay: WriteReplay): void {
  replays.set(kind, replay)
}

/** Test-only: forget every registered replay. */
export function __clearWriteReplaysForTests(): void {
  replays.clear()
}

/**
 * Attempt every queued write, oldest first, once each.
 *
 * Per-entry independence, exactly as `flushProofQueue` does: one poison row must
 * not starve the entries behind it. A row with no registered replay is left
 * alone rather than dropped — dropping it would discard the only record that the
 * user's write happened.
 */
export async function flushWriteQueue(): Promise<number> {
  const entries = await db.writes.orderBy('createdAt').toArray()
  let sent = 0

  for (const entry of entries) {
    const replay = replays.get(entry.kind)
    if (!replay) continue

    // Respect the backoff: without this, every reconnect event re-attempts every
    // row at once against a link that has just proved it cannot carry them.
    if (entry.retries > 0) {
      const dueAt = entry.createdAt + backoffMs(entry.retries - 1)
      if (Date.now() < dueAt) continue
    }

    try {
      const result = await replay(entry.eventId, JSON.parse(entry.payload))
      if (result.ok) {
        await db.writes.delete(entry.localId)
        sent++
      } else if (result.defer) {
        // Not this event's turn. Leave the row exactly as it is — no retry
        // counted, because nothing failed.
        continue
      } else {
        await markWriteFailed(entry.localId, result.message)
      }
    } catch (e) {
      await markWriteFailed(
        entry.localId,
        e instanceof Error ? e.message : 'Could not send that.',
      )
    }
  }

  return sent
}

/** Rows that have failed repeatedly, for a "needs attention" surface. */
export async function stuckWrites(
  minRetries = STUCK_AFTER_RETRIES,
): Promise<QueuedWrite[]> {
  return db.writes.filter((w) => w.retries >= minRetries).toArray()
}

/** Test-only: empty the queue. IndexedDB persists between vitest cases. */
export async function __clearWriteQueueForTests(): Promise<void> {
  await db.writes.clear()
}
