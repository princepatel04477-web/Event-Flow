import Dexie, { type Table } from 'dexie'

import { isCountedDue, STUCK_AFTER_RETRIES as SHARED_STUCK_AFTER_RETRIES } from '@/lib/outbox/schedule'

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

/**
 * How many writes are waiting, optionally narrowed to what a screen queued (M49).
 *
 * WHY THE ARGUMENT EXISTS. This used to be `db.writes.count()` — the WHOLE
 * queue, every kind, every event — and every screen rendered that number as if
 * it were its own. `RoomsBoard` adds the counts of the four hooks it mounts, so
 * one room change on a dead link rendered "4 room changes are saved on this
 * phone"; `CheckInClient` adds two and rendered "(2 waiting)" for one check-in.
 * Both numbers are false in the direction that erodes trust: a runner who is
 * told they have four changes waiting when they made one stops believing the
 * banner. `docs/BUGS.md` M49.
 *
 * A screen that wants the global total should read the shared `pending` store
 * (`src/lib/mutate/pending.ts`), which sums all four queues and exists precisely
 * so the number is stated once, honestly, in one place.
 */
export async function queuedWriteCount(filter?: {
  kind?: string
  eventId?: string
}): Promise<number> {
  if (!filter || (filter.kind === undefined && filter.eventId === undefined)) {
    return db.writes.count()
  }
  return db.writes
    .filter(
      (row) =>
        (filter.kind === undefined || row.kind === filter.kind) &&
        (filter.eventId === undefined || row.eventId === filter.eventId),
    )
    .count()
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

/**
 * Backoff before retry attempt `retries + 1`. Doubles from 2s, capped at 60s.
 *
 * Re-exported from the shared schedule so the four queues cannot drift apart
 * again — see `src/lib/outbox/schedule.ts` for why that mattered (M24).
 */
export { backoffMs } from '@/lib/outbox/schedule'

/** How many attempts before a write is surfaced as needing attention. */
export const STUCK_AFTER_RETRIES = SHARED_STUCK_AFTER_RETRIES

/** Is this row past its backoff? Both shapes live in the shared schedule. */
function isWriteDue(entry: { retries: number; createdAt: number }): boolean {
  return isCountedDue(entry)
}

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
  /**
   * The row's `localId`, so a replay can be idempotent where the action supports it.
   *
   * WHY THIS ARGUMENT EXISTS (B8). It was documented as the idempotency key and
   * never passed to anything, which made the claim false: the replay signature
   * was `(eventId, payload)` only. `assign-guests-room` places "the next
   * unplaced guests of this family", so a second replay of the SAME row is not a
   * duplicate of the first — it is a second placement, of different people, into
   * whichever room the payload names. Actions that can honour a key now get one;
   * `flushWriteQueue` also serialises itself (below), so the ordinary
   * double-flush is prevented before idempotency is even needed.
   */
  localId: string,
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
 * THE IN-FLIGHT GUARD (B8).
 *
 * Without it, `flushWriteQueue()` read the whole table into `entries` and then
 * awaited each replay, while every mounted `useOptimisticAction` installed its
 * OWN unconditional drain effect. On the offline→online transition all sibling
 * hooks fire in the same commit, read the same rows before any is deleted, and
 * each row is sent once per hook — four times on the Rooms board, where four
 * hooks are mounted. The row's `localId` was never passed downstream, so nothing
 * could dedupe the result; `assign-guests-room` replayed four times places four
 * different sets of a family's guests.
 *
 * A module-level promise is the right shape for this and a module-level BOOLEAN
 * is not: a second caller must be able to await the run already in progress (so
 * its `.then()` refreshes the count afterwards) rather than being told "no" and
 * reporting a backlog that no one is draining.
 */
let inFlightFlush: Promise<number> | null = null

/**
 * Attempt every queued write, oldest first, once each.
 *
 * Per-entry independence, exactly as `flushProofQueue` does: one poison row must
 * not starve the entries behind it. A row with no registered replay is left
 * alone rather than dropped — dropping it would discard the only record that the
 * user's write happened.
 *
 * CONCURRENT CALLERS SHARE ONE RUN. See `inFlightFlush`.
 */
export function flushWriteQueue(): Promise<number> {
  if (inFlightFlush) return inFlightFlush
  const run = drainWriteQueue().finally(() => {
    // Cleared before the callers' `.then()` handlers run, so the next drain
    // triggered by those handlers is a new run rather than a stale resolved
    // promise that would skip it.
    inFlightFlush = null
  })
  inFlightFlush = run
  return run
}

async function drainWriteQueue(): Promise<number> {
  const entries = await db.writes.orderBy('createdAt').toArray()
  let sent = 0

  for (const entry of entries) {
    const replay = replays.get(entry.kind)
    if (!replay) continue

    // Respect the backoff: without this, every reconnect event re-attempts every
    // row at once against a link that has just proved it cannot carry them.
    if (!isWriteDue(entry)) continue

    try {
      const result = await replay(entry.eventId, JSON.parse(entry.payload), entry.localId)
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

/** Test-only: forget an in-flight drain so a suite starts clean. */
export function __resetWriteFlushForTests(): void {
  inFlightFlush = null
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
