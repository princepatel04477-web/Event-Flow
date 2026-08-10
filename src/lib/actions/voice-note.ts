'use server'

import { createClient } from '@/lib/supabase/server'
import { getSessionClaims } from '@/lib/auth/server'

export type UploadVoiceNoteResult =
  | { ok: true; recordingId: string }
  | { ok: false; error: string }

/**
 * Upload a voice note recording to Supabase Storage and insert a
 * call_recordings row, triggering the existing STT pipeline.
 *
 * Follows the delivery_proofs pattern: storage upload, then insert,
 * attribution from the session. The source column marks this as
 * 'voice_note' so the extraction prompt weights it differently.
 *
 * Called from the browser. The audio is base64-encoded AAC.
 */
export async function uploadVoiceNote(input: {
  eventId: string
  groupId: string
  callAttemptId: string
  /** base64-encoded AAC audio */
  audioBase64: string
  /** Duration in seconds */
  durationSec: number
}): Promise<UploadVoiceNoteResult> {
  const supabase = await createClient()
  const claims = await getSessionClaims()

  const { data: { user } } = await supabase.auth.getUser()
  const staffMemberId = claims?.staffMemberId ?? null

  if (!user && !staffMemberId) {
    return { ok: false, error: 'No staff identity is selected. Pick who you are, then try again.' }
  }

  const fileId = crypto.randomUUID()
  const storagePath = `${input.eventId}/${input.groupId}/${fileId}.m4a`

  const binary = Uint8Array.from(atob(input.audioBase64), (c) => c.charCodeAt(0))

  const { error: uploadError } = await supabase.storage
    .from('call-recordings')
    .upload(storagePath, binary, { contentType: 'audio/mp4', upsert: false })

  if (uploadError) {
    return { ok: false, error: `Could not upload the recording: ${uploadError.message}` }
  }

  const { data: inserted, error: insertError } = await supabase
    .from('call_recordings')
    .insert({
      event_id: input.eventId,
      group_id: input.groupId,
      call_attempt_id: input.callAttemptId,
      storage_bucket: 'call-recordings',
      storage_path: storagePath,
      duration_sec: input.durationSec,
      mime_type: 'audio/mp4',
      source: 'voice_note',
      consent_given: true,
      ...(staffMemberId
        ? { uploaded_by: null, uploaded_by_staff: staffMemberId }
        : { uploaded_by: user?.id ?? null, uploaded_by_staff: null }),
    })
    .select('id')
    .single()

  if (insertError) {
    console.error('[uploadVoiceNote] insert failed', {
      sqlstate: insertError.code,
      message: insertError.message?.slice(0, 200),
      eventId: input.eventId,
      groupId: input.groupId,
    })
    return { ok: false, error: `Could not save recording: ${insertError.message}` }
  }

  return { ok: true, recordingId: inserted.id }
}
