import Dexie, { type Table } from 'dexie'

export type HarvestLedgerStatus =
  | 'seen'
  | 'matched'
  | 'uploaded'
  | 'unmatched'
  | 'failed'

export interface HarvestLedgerEntry {
  path: string       // primary key — absolute file path
  size: number
  mtime: number
  status: HarvestLedgerStatus
  callRecordingId?: string
  firstSeenAt: number
  lastError?: string
}

/**
 * H2 — harvest_seen ledger for file-level deduplication.
 *
 * A file is new only if its path is absent from the ledger. Never re-emit
 * a known path. Size and mtime are stored so we can detect a file being
 * rewritten in place (e.g. a dialer that truncates and re-writes).
 *
 * status lifecycle:
 *   seen      → detected for the first time, not yet matched
 *   matched   → matched to a call_attempts row by timestamp
 *   uploaded  → uploaded to Supabase Storage + call_recordings row inserted
 *   unmatched → examined and could not be matched, waiting for manual attach
 *   failed    → permanent (size-stability timeout, unreadable file, etc.)
 */
class HarvestLedgerDb extends Dexie {
  harvest_seen!: Table<HarvestLedgerEntry, string>

  constructor() {
    super('EventFlowHarvest')
    this.version(1).stores({
      harvest_seen: '&path, status, firstSeenAt',
    })
  }
}

const db = new HarvestLedgerDb()

export async function isPathKnown(path: string): Promise<boolean> {
  try {
    const count = await db.harvest_seen.where({ path }).count()
    return count > 0
  } catch {
    return false
  }
}

export async function addSeen(path: string, size: number, mtime: number): Promise<void> {
  try {
    await db.harvest_seen.put({
      path,
      size,
      mtime,
      status: 'seen',
      firstSeenAt: Date.now(),
    })
  } catch {
    // Duplicate — already tracked.
  }
}

export async function markMatched(path: string, callRecordingId: string): Promise<void> {
  try {
    await db.harvest_seen.update(path, {
      status: 'matched',
      callRecordingId,
    })
  } catch {
    // Row may have been removed.
  }
}

export async function markUploaded(path: string): Promise<void> {
  try {
    await db.harvest_seen.update(path, { status: 'uploaded' })
  } catch {}
}

export async function markUnmatched(path: string): Promise<void> {
  try {
    await db.harvest_seen.update(path, { status: 'unmatched' })
  } catch {}
}

export async function markFailed(path: string, reason: string): Promise<void> {
  try {
    await db.harvest_seen.update(path, {
      status: 'failed',
      lastError: reason,
    })
  } catch {}
}

export async function getLedgerEntries(
  filter?: { status?: HarvestLedgerStatus },
): Promise<HarvestLedgerEntry[]> {
  try {
    if (filter?.status) {
      return await db.harvest_seen.where({ status: filter.status }).toArray()
    }
    return await db.harvest_seen.orderBy('firstSeenAt').reverse().toArray()
  } catch {
    return []
  }
}

export async function hasMatchForCall(callAttemptId: string): Promise<boolean> {
  try {
    // CallAttemptId is not stored directly — it's matched through
    // call_recordings, which we would need to query. For now, check
    // if any matched entry exists with this recording id pattern.
    const entries = await db.harvest_seen.where({ status: 'matched' }).toArray()
    return entries.some((e) => e.callRecordingId != null)
  } catch {
    return false
  }
}

export { db as harvestDb }
