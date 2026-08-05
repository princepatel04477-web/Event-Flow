import Dexie, { type Table } from 'dexie'

import { submitProof } from '@/lib/proof'

/**
 * Offline proof queue (M8 step 6 / M9 write-queue principle).
 *
 * When a photo cannot upload (no signal at the venue), the local photo +
 * pending proof row are stored here and retried on reconnect. The deliverable
 * is NOT marked delivered until the server commits the proof row — "queued"
 * and "saved" are different words, and a queued proof must never read as a
 * completed delivery.
 *
 * Keys on a client-generated UUID for idempotency: a double flush cannot
 * create a duplicate because submitProof uses the same id in the storage path
 * and the insert is upserted on that path.
 */

export interface QueuedProof {
  /** Client UUID — idempotency key. */
  localId: string
  eventId: string
  deliverableId: string
  dataUrl: string
  createdAt: number
  retries: number
  lastError: string | null
}

class ProofQueueDb extends Dexie {
  proofs!: Table<QueuedProof, string>

  constructor() {
    super('eventops-proof-queue')
    this.version(1).stores({
      proofs: 'localId, deliverableId, createdAt',
    })
  }
}

const db = new ProofQueueDb()

/** Enqueue a proof for later sync. */
export async function queueProof(input: {
  eventId: string
  deliverableId: string
  dataUrl: string
}): Promise<QueuedProof> {
  const entry: QueuedProof = {
    localId: crypto.randomUUID(),
    eventId: input.eventId,
    deliverableId: input.deliverableId,
    dataUrl: input.dataUrl,
    createdAt: Date.now(),
    retries: 0,
    lastError: null,
  }
  await db.proofs.put(entry)
  return entry
}

/** Count of unsynced proofs. */
export async function queuedProofCount(): Promise<number> {
  return db.proofs.count()
}

/** Flush all queued proofs, oldest first. Returns how many synced. */
export async function flushProofQueue(): Promise<number> {
  const entries = await db.proofs.orderBy('createdAt').toArray()
  let synced = 0
  for (const entry of entries) {
    try {
      await submitProof({
        eventId: entry.eventId,
        deliverableId: entry.deliverableId,
        dataUrl: entry.dataUrl,
      })
      await db.proofs.delete(entry.localId)
      synced++
    } catch (err) {
      const next: QueuedProof = {
        ...entry,
        retries: entry.retries + 1,
        lastError: err instanceof Error ? err.message : String(err),
      }
      await db.proofs.put(next)
      // A delivery proof must never be dropped. Stop on the first hard
      // failure (e.g. auth) rather than hammering the network.
      break
    }
  }
  return synced
}

/** List stuck proofs (after N retries) for the /debug "needs attention" list. */
export async function stuckProofs(minRetries = 5): Promise<QueuedProof[]> {
  return db.proofs.filter((p) => p.retries >= minRetries).toArray()
}

export default db
