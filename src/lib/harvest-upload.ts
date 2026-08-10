'use server'

import { createClient } from '@/lib/supabase/server'

export type UploadRecordingResult =
  | { ok: true; recordingId: string }
  | { ok: false; error: string }

/**
 * Upload a call recording file to Supabase Storage and insert a
 * call_recordings row. This triggers the existing STT pipeline
 * (webhook → transcribe-recording → Sarvam → extraction → review).
 *
 * Called from the client after a file is found, matched, and staff
 * consents. The file content arrives as base64 (read by Capacitor
 * Filesystem on the handset).
 *
 * Attribution: follows the split-column rule — team sessions set
 * uploaded_by_staff from the JWT claim, admins set uploaded_by from
 * auth.uid(). The `source` column is 'harvested' (auto-pulled from
 * the OEM dialer folder).
 */
export async function uploadHarvestedRecording(input: {
  eventId: string
  groupId: string
  callAttemptId: string
  fileBase64: string
  /** Original filename for the extension */
  fileName: string
  /** Duration in seconds, or null if unknown */
  durationSec: number | null
  /** Whether staff confirmed the consent disclosure was read */
  consentGiven: boolean
}): Promise<UploadRecordingResult> {
  if (!input.consentGiven) {
    return { ok: false, error: 'Consent must be given before uploading.' }
  }

  const supabase = await createClient()

  const { getSessionClaims } = await import('@/lib/auth/server')
  const claims = await getSessionClaims()
  const { data: { user } } = await supabase.auth.getUser()
  const staffMemberId = claims?.staffMemberId ?? null

  if (!user && !staffMemberId) {
    return { ok: false, error: 'No staff identity selected. Pick who you are first.' }
  }

  // Determine extension from filename
  const ext = input.fileName.includes('.')
    ? input.fileName.split('.').pop()?.toLowerCase() ?? 'm4a'
    : 'm4a'

  const fileId = crypto.randomUUID()
  const storagePath = `${input.eventId}/${input.groupId}/${fileId}.${ext}`

  const binary = Uint8Array.from(atob(input.fileBase64), (c) => c.charCodeAt(0))

  const { error: uploadError } = await supabase.storage
    .from('call-recordings')
    .upload(storagePath, binary, {
      contentType: 'audio/mp4',
      upsert: false,
    })

  if (uploadError) {
    return { ok: false, error: `Could not upload: ${uploadError.message}` }
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
      source: 'harvested',
      consent_given: input.consentGiven,
      ...(staffMemberId
        ? { uploaded_by: null, uploaded_by_staff: staffMemberId }
        : { uploaded_by: user?.id ?? null, uploaded_by_staff: null }),
    })
    .select('id')
    .single()

  if (insertError) {
    console.error('[uploadHarvestedRecording] insert failed', {
      sqlstate: insertError.code,
      message: insertError.message?.slice(0, 200),
      eventId: input.eventId,
      groupId: input.groupId,
    })
    return { ok: false, error: `Could not save recording: ${insertError.message}` }
  }

  return { ok: true, recordingId: inserted.id }
}
