import Dexie, { type Table } from 'dexie'

import type { PersistedSnapshot } from './types'

/**
 * IndexedDB persistence for the event store.
 *
 * ONE ROW PER EVENT, holding the whole normalised event. Not one row per
 * family, and that is the decision that makes "reopen the app and the screen is
 * there" cost one read rather than eighteen hundred: the store's state is a
 * document (record maps built from arrays), and reconstructing it from
 * per-row tables would mean a query per table on every cold start, i.e. the
 * exact fan-out of round trips this whole feature removes.
 *
 * Its own Dexie database, deliberately NOT the same one as
 * `eventops-write-queue` or `eventops-proof-queue`. A snapshot is large and
 * rewritten as a whole on every revalidate; putting it in the same database as
 * the outbox would mean a large `put` can block the transaction that stores a
 * write the user just made. Separate databases keep the outbox's latency
 * independent of the snapshot's size — which is what makes "the tap is saved"
 * true even when a 300 KB snapshot is being written at the same moment.
 *
 * WHAT IS PERSISTED IS THE NORMALISED STATE, not the raw payload. Storing the
 * raw JSON and re-parsing on every cold start would pay the validation and
 * indexing cost (tens of milliseconds on a cheap Android) on the one path
 * whose entire budget is 120 ms.
 */

class EventStoreDb extends Dexie {
  snapshots!: Table<PersistedSnapshot, string>

  constructor() {
    super('eventflow-event-store')
    this.version(1).stores({
      // Primary key is the event id: one snapshot per event, and the same
      // browser legitimately holds two (EventSwitcher).
      snapshots: 'eventId, savedAt',
    })
  }
}

const db = new EventStoreDb()

/** Read a cached event, or null. Never throws — a miss is a miss. */
export async function readCachedSnapshot(eventId: string): Promise<PersistedSnapshot | null> {
  try {
    return (await db.snapshots.get(eventId)) ?? null
  } catch {
    // Private mode, a cleared profile, a quota-evicted database: all of these
    // are "no cache", not an error the user needs to see. The store falls back
    // to the network exactly as it would on a first launch.
    return null
  }
}

/** Persist an event. Failures are swallowed for the same reason as above. */
export async function writeCachedSnapshot(snapshot: PersistedSnapshot): Promise<void> {
  try {
    await db.snapshots.put(snapshot)
  } catch {
    // A full disk must not break the app: the in-memory store is already
    // correct, only the next cold start loses its head start.
  }
}

/** Drop one event's cache (sign-out, or a payload version change). */
export async function clearCachedSnapshot(eventId: string): Promise<void> {
  try {
    await db.snapshots.delete(eventId)
  } catch {
    // Nothing to do; the row is already unreadable or gone.
  }
}

/** Test-only: empty the store. IndexedDB persists between vitest cases. */
export async function __clearEventStoreForTests(): Promise<void> {
  await db.snapshots.clear()
}
