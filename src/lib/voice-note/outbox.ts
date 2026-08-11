/**
 * IndexedDB outbox for voice notes captured with no usable connection.
 *
 * A staff member in a hotel basement records a summary, the upload fails, and
 * without this the audio is gone the moment the component unmounts. The call
 * outcome already survives that (see `lib/call/outbox.ts`); the recording must
 * too, or the offline story is only half true.
 *
 * The Blob is stored directly — IndexedDB stores Blobs natively, so there is
 * no base64 round-trip and a three-minute note costs its real size rather than
 * a third more.
 *
 * Keyed by `callAttemptId`: a family gets one voice note per attempt, so
 * re-queueing the same attempt replaces rather than duplicates. Re-recording
 * after a failed upload is a correction, not a second note.
 */
'use client'

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

const DB_NAME = 'eventflow-voice-notes'
const DB_VERSION = 1
const STORE = 'pending-recordings'

export interface PendingVoiceNote {
  callAttemptId: string
  eventId: string
  eventCode: string
  groupId: string
  blob: Blob
  mimeType: string
  extension: string
  durationSec: number
  /**
   * The storage path chosen when the note was first queued. Reused on every
   * retry so a half-finished upload resumes onto the same object instead of
   * scattering orphans through the bucket.
   */
  storagePath: string
  queuedAt: string
  attempts: number
  /** Why the last attempt failed, for honest UI copy. */
  lastError?: string
}

interface VoiceNoteDb extends DBSchema {
  [STORE]: {
    key: string // callAttemptId
    value: PendingVoiceNote
  }
}

let dbPromise: Promise<IDBPDatabase<VoiceNoteDb>> | null = null

function getDb(): Promise<IDBPDatabase<VoiceNoteDb>> {
  if (!dbPromise) {
    dbPromise = openDB<VoiceNoteDb>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'callAttemptId' })
        }
      },
    })
  }
  return dbPromise
}

export async function queueVoiceNote(note: PendingVoiceNote): Promise<void> {
  const db = await getDb()
  await db.put(STORE, note)
}

export async function listQueuedVoiceNotes(): Promise<PendingVoiceNote[]> {
  const db = await getDb()
  return db.getAll(STORE)
}

export async function removeQueuedVoiceNote(callAttemptId: string): Promise<void> {
  const db = await getDb()
  await db.delete(STORE, callAttemptId)
}

export async function markVoiceNoteAttempt(
  callAttemptId: string,
  lastError: string,
): Promise<void> {
  const db = await getDb()
  const existing = await db.get(STORE, callAttemptId)
  if (!existing) return
  await db.put(STORE, { ...existing, attempts: existing.attempts + 1, lastError })
}
