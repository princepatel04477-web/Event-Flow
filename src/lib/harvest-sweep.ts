'use client'

/**
 * The harvest sweep: everything between "the dialer wrote a file" and "the
 * transcription pipeline has it".
 *
 * WHY A SWEEP AND NOT JUST THE WATCHER
 *
 * The native plugin's `recordingDetected` event is an inotify watch inside the
 * app process. It is the fast path, not a guarantee: inotify drops events
 * under load, the watch dies when Android kills the process, and the OEM
 * dialer often writes a temp file and renames it, so the event can arrive
 * naming a path that is already gone. A timer that re-lists the folders
 * catches every one of those cases. The watcher makes it quick; the sweep
 * makes it certain.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It does not run in the background. A WebView cannot, and pretending
 * otherwise would be the worst kind of half-feature: staff would believe calls
 * were being captured while the app was closed. Capture happens while the app
 * is open, and the sweep on open picks up whatever happened in between —
 * which is why `enabledAt` is a floor and not a filter on "new since the last
 * sweep".
 */

import {
  addSeen,
  getLedgerEntries,
  markFailed,
  markMatched,
  markSkipped,
  markUnmatched,
  markUploaded,
  rememberStoragePath,
  type HarvestLedgerEntry,
} from '@/lib/harvest-ledger'
import { matchRecording } from '@/lib/harvest-match'
import {
  buildHarvestStoragePath,
  commitHarvestedRecording,
  contentTypeFor,
  extensionOf,
} from '@/lib/harvest-upload'
import { discoverFolders, getDuration, listFiles, type RecordingFile } from '@/lib/harvest'

/**
 * How long a file must have sat still before it is read.
 *
 * The dialer writes the recording as the call ends, and a file read mid-write
 * uploads a truncated recording — which transcribes to a truncated answer that
 * nobody can tell is truncated. `ageSec` from the plugin is the cheap version
 * of a size-stability check and needs no second listing.
 */
const STABILITY_SEC = 15

/** Upload at most this many per sweep, so one sweep cannot saturate a 3G uplink. */
const MAX_PER_SWEEP = 3

export const SWEEP_INTERVAL_MS = 30_000

export interface SweepOutcome {
  /** Files committed to `call_recordings` this sweep. */
  uploaded: number
  /** Files that could not be tied to a family; they wait in the unmatched tray. */
  unmatched: number
  /** Files held back this sweep — still being written, or over the per-sweep cap. */
  deferred: number
  failed: number
  /** Reminder calls that were skipped rather than uploaded. */
  skipped: number
  /** The most recent human-readable problem, for the status line. */
  lastError?: string
}

const EMPTY: SweepOutcome = { uploaded: 0, unmatched: 0, deferred: 0, failed: 0, skipped: 0 }

/**
 * A path is worth looking at when the ledger has never resolved it. `seen` is
 * retried (it means "noticed, not yet handled"), and so is a previous upload
 * failure. `uploaded` and `unmatched` are terminal here — the first is done,
 * the second is a decision for the unmatched tray, not for a retry loop.
 */
function isPending(entry: HarvestLedgerEntry | undefined): boolean {
  if (!entry) return true
  return entry.status === 'seen' || entry.status === 'matched'
}

/**
 * One pass over every discovered folder.
 *
 * `enabledAt` is the moment staff switched capture on. Files older than it are
 * skipped and never recorded, because a phone that has been in service for
 * weeks holds a back catalogue of calls that predate consent — uploading those
 * would bill STT for recordings nobody agreed to hand over, and no amount of
 * later tidying can unsend them.
 */
export async function sweepHarvest(input: {
  eventId: string
  eventCode: string
  enabledAt: number
  consentGiven: boolean
  /** Cached between sweeps by the caller; discovery re-scans the filesystem. */
  folders?: string[]
}): Promise<SweepOutcome> {
  if (!input.consentGiven) return EMPTY

  const folders = input.folders?.length ? input.folders : await discoverFolders()
  if (folders.length === 0) return EMPTY

  const ledger = new Map(
    (await getLedgerEntries()).map((e) => [e.path, e] as const),
  )

  const candidates: RecordingFile[] = []
  for (const folder of folders) {
    for (const file of await listFiles(folder)) {
      if (file.mtime < input.enabledAt) continue
      if (file.size <= 0) continue
      if (!contentTypeFor(file.name)) continue
      if (!isPending(ledger.get(file.path))) continue
      candidates.push(file)
    }
  }

  // Oldest first: a backlog drains in the order the calls happened, so the
  // review screen reads as the day did.
  candidates.sort((a, b) => a.mtime - b.mtime)

  const outcome: SweepOutcome = { ...EMPTY }

  for (const file of candidates) {
    if (outcome.uploaded + outcome.failed >= MAX_PER_SWEEP) {
      outcome.deferred += 1
      continue
    }
    if (file.ageSec < STABILITY_SEC) {
      outcome.deferred += 1
      continue
    }

    const known = ledger.get(file.path)
    if (!known) await addSeen(file.path, file.size, file.mtime)

    const durationSec = await getDuration(file.path)

    const match = await matchRecording({
      filePath: file.path,
      fileSize: file.size,
      fileMtime: file.mtime,
      durationSec,
      eventId: input.eventId,
    })

    if (match.kind === 'error') {
      outcome.failed += 1
      outcome.lastError = match.message
      continue
    }

    if (match.kind === 'unmatched') {
      // Not a failure. The audio is on the phone and the tray can attach it to
      // a family by hand; marking it failed would hide it from the one screen
      // that can still rescue it.
      await markUnmatched(file.path)
      outcome.unmatched += 1
      outcome.lastError = match.reason
      continue
    }

    if (match.kind === 'matched' && match.callKind === 'reminder') {
      await markSkipped(file.path, 'Reminder call: not recorded.')
      outcome.skipped += 1
      continue
    }

    const storagePath =
      known?.storagePath ??
      buildHarvestStoragePath(input.eventId, match.groupId, extensionOf(file.name))
    await rememberStoragePath(file.path, storagePath)

    const result = await commitHarvestedRecording({
      eventId: input.eventId,
      eventCode: input.eventCode,
      groupId: match.groupId,
      callAttemptId: match.callAttemptId,
      filePath: file.path,
      fileName: file.name,
      durationSec,
      consentGiven: input.consentGiven,
      storagePath,
    })

    if (!result.ok) {
      // Left as `seen`, not `failed`: the usual reason is no signal, and the
      // next sweep retries onto the same storage path.
      outcome.failed += 1
      outcome.lastError = result.error
      continue
    }

    await markMatched(file.path, result.recordingId)
    await markUploaded(file.path)
    outcome.uploaded += 1
  }

  return outcome
}

/**
 * Give up on a file for good. Used by the UI for a file that has failed enough
 * times that retrying it every thirty seconds is just noise.
 */
export async function abandonHarvestFile(path: string, reason: string): Promise<void> {
  await markFailed(path, reason)
}
