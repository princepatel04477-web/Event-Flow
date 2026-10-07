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
  /** When the last sync was ATTEMPTED. Backoff is measured from here. */
  lastAttemptAt: number | null
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
  /**
   * Idempotency key. The delivery screen mints one BEFORE its first attempt so a
   * response lost after the upload + insert already committed reuses the SAME
   * key on the queued retry — the storage_path unique index then recognises the
   * already-synced proof instead of admitting a second one.
   */
  localId?: string
}): Promise<QueuedProof> {
  const entry: QueuedProof = {
    localId: input.localId ?? crypto.randomUUID(),
    eventId: input.eventId,
    deliverableId: input.deliverableId,
    dataUrl: input.dataUrl,
    createdAt: Date.now(),
    lastAttemptAt: null,
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

/** Backoff delay in ms before retry attempt `retries+1`. Cap at 60s. */
export function backoffMs(retries: number): number {
  return Math.min(60_000, Math.pow(2, retries) * 2_000)
}

/** How many attempts before a proof is surfaced as "needs attention". */
export const STUCK_AFTER_RETRIES = 5

/** The in-flight drain, so concurrent callers share one pass. See flushProofQueue. */
let inflightFlush: Promise<number> | null = null

/**
 * Flush all queued proofs, oldest first. Each entry is attempted once,
 * independently — one failure never blocks the rest. Returns how many
 * synced. Callers (OfflineBanner) should only invoke this when online, and
 * the per-entry backoff spreads retries rather than hammering.
 */
export async function flushProofQueue(): Promise<number> {
  // ONE drain at a time, module-wide — same guard as flushWriteQueue. Two
  // callers firing in the same commit (the banner, a screen) would otherwise
  // both read the same rows and sync the same proof twice. The storage_path
  // unique index makes the second attempt harmless, but it is still a wasted
  // round trip per duplicate; the guard removes it.
  if (inflightFlush) return inflightFlush
  const run = drainProofQueue()
  inflightFlush = run
  try {
    return await run
  } finally {
    if (inflightFlush === run) inflightFlush = null
  }
}

async function drainProofQueue(): Promise<number> {
  const entries = await db.proofs.orderBy('createdAt').toArray()
  let synced = 0
  for (const entry of entries) {
    // Honour the per-entry backoff `backoffMs` documents but this loop never
    // applied: it re-attempted every row on every flush regardless of `retries`,
    // so a dead link was hammered on every reconnect/foreground event. Measured
    // from the last ATTEMPT, not from creation.
    if (entry.retries > 0) {
      const from = entry.lastAttemptAt ?? entry.createdAt
      if (Date.now() < from + backoffMs(entry.retries - 1)) continue
    }
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
        lastAttemptAt: Date.now(),
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
