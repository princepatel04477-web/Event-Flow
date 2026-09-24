import Dexie, { type Table } from 'dexie'

import { submitProof } from '@/lib/proof'
import {
  isCountedDue,
  STUCK_AFTER_RETRIES as SHARED_STUCK_AFTER_RETRIES,
} from '@/lib/outbox/schedule'

/**
 * Offline proof queue (M8 step 6 / M9 write-queue principle).
 *
 * When a photo cannot upload (no signal at the venue), the local photo +
 * pending proof row are stored here and retried on reconnect. The deliverable
 * is NOT marked delivered until the server commits the proof row — "queued"
 * and "saved" are different words, and a queued proof must never read as a
 * completed delivery.
 *
 * Idempotency: `localId` is passed to submitProof() and embedded in the
 * storage filename; delivery_proofs.storage_path is UNIQUE, so a double
 * flush of the same entry cannot create a second proof row. submitProof()
 * treats the unique violation as "already synced" and returns the existing
 * row.
 *
 * Backoff: retries are spread out (attempt N waits 2^(N-1) * 2s, capped at
 * 60s) instead of hammering a dead connection on every reconnect event.
 *
 * A single poison row (e.g. permanent auth failure) no longer blocks the
 * rest of the queue: each entry is attempted independently, failures are
 * recorded on the row, and rows past the retry ceiling surface in the
 * "needs attention" list instead of vanishing.
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

/**
 * Enqueue a proof for later sync.
 *
 * `idempotencyKey` IS THE CALLER'S, WHEN IT HAS ONE (B6). It is embedded in the
 * storage filename and `delivery_proofs.storage_path` is unique, so reusing the
 * key the failed submit already used is what makes the replay recognise a proof
 * that committed before the response was lost — the 23505 branch in
 * `submitProof` treats it as "already synced". Minting a fresh key in here, as
 * this function used to, guaranteed the opposite: a new path, a second row, and
 * `delivery_proofs` cannot be corrected afterwards.
 *
 * The fallback stays for callers that never attempted a submit (a proof queued
 * straight from the camera with no signal), where there is nothing to collide
 * with and a fresh key is simply the row's identity.
 */
export async function queueProof(input: {
  eventId: string
  deliverableId: string
  dataUrl: string
  idempotencyKey?: string
}): Promise<QueuedProof> {
  const entry: QueuedProof = {
    localId: input.idempotencyKey ?? crypto.randomUUID(),
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

/** Backoff before retry `retries + 1`. Re-exported from the shared schedule. */
export { backoffMs } from '@/lib/outbox/schedule'

/** How many attempts before a proof is surfaced as "needs attention". */
export const STUCK_AFTER_RETRIES = SHARED_STUCK_AFTER_RETRIES

/**
 * Flush all queued proofs, oldest first. Each entry is attempted once,
 * independently — one failure never blocks the rest. Returns how many
 * synced.
 *
 * THE PER-ENTRY BACKOFF IS NOW REAL (M23/M24). The comment above used to promise
 * one while the loop attempted every row on every call and the only caller was a
 * single `useEffect` keyed on `online`. A proof queued by a transport failure on
 * associated-but-dead Wi-Fi saw `online` never change, so nothing ever retried
 * it: the photo sat in IndexedDB until the next full app launch while the banner
 * said "will sync when online" — while online. The drain is driven by the shared
 * `scheduleDrain` (mount, `online`, foreground, and a 15s interval) and this loop
 * respects `isCountedDue`, so a frequent trigger cannot become a retry storm.
 */
export async function flushProofQueue(): Promise<number> {
  const entries = await db.proofs.orderBy('createdAt').toArray()
  let synced = 0
  for (const entry of entries) {
    if (!isCountedDue(entry)) continue
    try {
      await submitProof({
        eventId: entry.eventId,
        deliverableId: entry.deliverableId,
        dataUrl: entry.dataUrl,
        idempotencyKey: entry.localId,
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
      // Do not break: a poison row must not starve the entries behind it.
      // Rows past STUCK_AFTER_RETRIES surface in stuckProofs()/debug.
    }
  }
  return synced
}

/** List stuck proofs (after N retries) for the /debug "needs attention" list. */
export async function stuckProofs(minRetries = STUCK_AFTER_RETRIES): Promise<QueuedProof[]> {
  return db.proofs.filter((p) => p.retries >= minRetries).toArray()
}

export default db
