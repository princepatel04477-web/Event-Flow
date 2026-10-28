'use client'

/**
 * The one path from a file the OEM dialer left on the phone to a committed
 * `call_recordings` row.
 *
 * WHY THIS IS A CLIENT MODULE AND NOT A SERVER ACTION
 *
 * It used to be `uploadHarvestedRecording`, a server action taking the whole
 * file as base64. That could not ship: Next's `serverActions.bodySizeLimit`
 * defaults to 1 MB and base64 inflates by a third, so a recording of a
 * four-minute call failed before it left the handset. The same ceiling already
 * forced `lib/voice-note/upload.ts` into this shape, and this is deliberately
 * the same two steps in the same order:
 *
 *   1. bytes → Storage, straight from the browser client.
 *   2. storage path → `registerHarvestedRecording()`, which writes the row
 *      with server-resolved attribution.
 *
 * If (1) fails there is no row and no audio, and the ledger keeps the path as
 * `seen` so the next sweep retries it. If (2) fails the audio is uploaded but
 * unreferenced; the retry re-uploads onto the SAME path, so sweeping twice
 * cannot litter the bucket. A row is never written for audio that is not
 * already there — `call_recordings` has `no_update` and `no_delete` triggers,
 * so a row pointing at nothing could never be repaired.
 */

import { Filesystem } from '@capacitor/filesystem'

import { registerHarvestedRecording } from '@/lib/actions/harvest'
import { uploadMedia } from '@/lib/media/client'

export type HarvestCommitResult =
  | { ok: true; recordingId: string }
  | { ok: false; error: string; diagnostic?: string }

/**
 * Audio containers an OEM dialer actually writes, mapped to the content type
 * Storage should serve them as. Sarvam is handed the object by its storage
 * path, so a file named `.m4a` and served as `audio/mpeg` is handed to the STT
 * API as a format it is not — the exact mislabelling the voice-note recorder
 * documents at length. Never guess a type for an extension not listed here.
 */
const CONTENT_TYPES: Record<string, string> = {
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  amr: 'audio/amr',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  '3gp': 'audio/3gpp',
  '3gpp': 'audio/3gpp',
}

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  if (dot < 0 || dot === fileName.length - 1) return ''
  return fileName.slice(dot + 1).toLowerCase()
}

export function contentTypeFor(fileName: string): string | null {
  return CONTENT_TYPES[extensionOf(fileName)] ?? null
}

/**
 * Storage paths must start with the event id — the bucket policy reads the
 * first folder segment as the tenant key and casts it to uuid (CLAUDE.md §12).
 */
export function buildHarvestStoragePath(
  eventId: string,
  groupId: string,
  extension: string,
): string {
  return `${eventId}/${groupId}/harvested-${crypto.randomUUID()}.${extension}`
}

function base64ToBlob(base64: string, contentType: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: contentType })
}

/** Read a file the harvest plugin found. Absolute paths need the `file://` scheme. */
async function readRecordingFile(path: string, contentType: string): Promise<Blob> {
  const uri = path.startsWith('file://') ? path : `file://${path}`
  const { data } = await Filesystem.readFile({ path: uri })
  if (typeof data !== 'string') {
    // The web implementation resolves a Blob; native always resolves base64.
    return new Blob([data], { type: contentType })
  }
  return base64ToBlob(data, contentType)
}

export async function commitHarvestedRecording(input: {
  eventId: string
  eventCode: string
  groupId: string
  callAttemptId: string | null
  /** Absolute path on the handset, as the harvest plugin reported it. */
  filePath: string
  fileName: string
  durationSec: number | null
  consentGiven: boolean
  /** Reuses the path a previous attempt already owns, so retries do not scatter orphans. */
  storagePath?: string
}): Promise<HarvestCommitResult> {
  const contentType = contentTypeFor(input.fileName)
  if (!contentType) {
    return {
      ok: false,
      error:
        `This phone saved the recording as .${extensionOf(input.fileName) || 'an unknown type'}, ` +
        'which transcription cannot read. Nothing was uploaded.',
    }
  }

  const storagePath =
    input.storagePath ??
    buildHarvestStoragePath(input.eventId, input.groupId, extensionOf(input.fileName))

  let blob: Blob
  try {
    blob = await readRecordingFile(input.filePath, contentType)
  } catch (err) {
    return {
      ok: false,
      error:
        'This phone would not let the app read the recording file. ' +
        'Check that "All files access" is still granted to EventFlow. ' +
        `(${err instanceof Error ? err.message : 'read failed'})`,
    }
  }

  if (blob.size === 0) {
    return { ok: false, error: 'The recording file is empty, so nothing was uploaded.' }
  }

  const uploaded = await uploadMedia({
    bucket: 'eventflow-call-recordings',
    key: storagePath,
    blob,
    contentType,
  })

  if (!uploaded.ok) {
    return { ok: false, error: uploaded.error }
  }

  const result = await registerHarvestedRecording({
    eventId: input.eventId,
    eventCode: input.eventCode,
    groupId: input.groupId,
    callAttemptId: input.callAttemptId,
    storagePath,
    mimeType: contentType,
    durationSec: input.durationSec,
    consentGiven: input.consentGiven,
  })

  if (!result.ok) {
    return { ok: false, error: result.error, diagnostic: result.diagnostic }
  }

  return { ok: true, recordingId: result.recordingId }
}
