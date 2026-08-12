'use client'

/**
 * The one path from a captured voice note to a committed `call_recordings`
 * row. Used both by the live "record → keep" flow and by the offline drain,
 * so a note that syncs three hours later lands identically to one that
 * uploaded straight away.
 *
 * Two steps, in this order, always:
 *
 *   1. Blob → Storage, from the browser client. Direct upload is not an
 *      optimisation: Vercel caps a serverless request body at 4.5 MB and no
 *      Next config raises it, so audio genuinely cannot travel through a
 *      server action.
 *   2. Storage path → `registerVoiceNote()`, which writes the row with
 *      server-resolved attribution.
 *
 * If (1) fails there is no row and no audio — the note stays queued.
 * If (2) fails the audio is uploaded but unreferenced; the note stays queued
 * and retries onto the SAME path (`upsert: true` on retry), so draining twice
 * cannot litter the bucket. A recording row is never written for audio that
 * is not already there.
 */

import { supabase } from '@/lib/supabase/client'
import { registerVoiceNote } from '@/lib/actions/voice-note'

import {
  markVoiceNoteAttempt,
  queueVoiceNote,
  removeQueuedVoiceNote,
  listQueuedVoiceNotes,
  type PendingVoiceNote,
} from './outbox'

export type VoiceNoteUploadResult =
  | { ok: true; recordingId: string }
  | { ok: false; error: string; queued: boolean; diagnostic?: string }

/**
 * Storage paths must start with the event id — the bucket policy reads the
 * first folder segment as the tenant key and casts it to uuid. See CLAUDE.md
 * §12. Anything else is rejected at upload time.
 */
export function buildStoragePath(eventId: string, groupId: string, extension: string): string {
  return `${eventId}/${groupId}/${crypto.randomUUID()}.${extension}`
}

/**
 * Try to commit one note. On any failure the note is left (or placed) in the
 * outbox and `queued: true` comes back, so the caller can say "held on this
 * phone" instead of "lost".
 */
export async function commitVoiceNote(
  note: PendingVoiceNote,
  { isRetry = false }: { isRetry?: boolean } = {},
): Promise<VoiceNoteUploadResult> {
  const { error: uploadError } = await supabase.storage
    .from('call-recordings')
    .upload(note.storagePath, note.blob, {
      contentType: note.mimeType,
      // A retry re-uploads onto the path this note already owns. Without
      // upsert the second attempt fails with "already exists" for a note whose
      // audio landed but whose row insert did not — the exact case retry is for.
      upsert: isRetry,
    })

  if (uploadError) {
    await queueVoiceNote(note)
    await markVoiceNoteAttempt(note.callAttemptId, uploadError.message)
    return {
      ok: false,
      queued: true,
      error: `Could not upload the recording: ${uploadError.message}`,
    }
  }

  const result = await registerVoiceNote({
    eventId: note.eventId,
    eventCode: note.eventCode,
    groupId: note.groupId,
    callAttemptId: note.callAttemptId,
    storagePath: note.storagePath,
    mimeType: note.mimeType,
    durationSec: note.durationSec,
  })

  if (!result.ok) {
    await queueVoiceNote(note)
    await markVoiceNoteAttempt(note.callAttemptId, result.error)
    return { ok: false, queued: true, error: result.error, diagnostic: result.diagnostic }
  }

  await removeQueuedVoiceNote(note.callAttemptId)
  return { ok: true, recordingId: result.recordingId }
}

/**
 * Drain every queued note. Called on mount and on `online`. Failures stay
 * queued for the next drain — nothing is ever dropped to make the count go
 * down.
 */
export async function drainVoiceNotes(): Promise<{ synced: number; stillQueued: number }> {
  const items = await listQueuedVoiceNotes()
  let synced = 0
  let stillQueued = 0

  for (const item of items) {
    try {
      const result = await commitVoiceNote(item, { isRetry: true })
      if (result.ok) synced += 1
      else stillQueued += 1
    } catch (err) {
      await markVoiceNoteAttempt(
        item.callAttemptId,
        err instanceof Error ? err.message : 'unknown error',
      )
      stillQueued += 1
    }
  }

  return { synced, stillQueued }
}
