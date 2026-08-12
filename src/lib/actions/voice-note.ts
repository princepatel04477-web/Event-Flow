
import { supabase } from '@/lib/supabase/client'
import { readSessionClaims } from '@/lib/auth/session-client'

export type RegisterVoiceNoteResult =
  | { ok: true; recordingId: string }
  | { ok: false; error: string; /** `step=… code=… at=…`, for Sentry. Never shown to staff. */ diagnostic?: string }

/**
 * Insert the `call_recordings` row for an already-uploaded voice note.
 *
 * WHY THE AUDIO DOES NOT COME THROUGH HERE
 *
 * The previous version took the whole file as base64 in the server-action
 * body. Two hard ceilings made that unshippable:
 *
 *   - Next's `serverActions.bodySizeLimit` defaults to 1 MB.
 *   - Vercel caps a serverless request body at 4.5 MB, which no config can
 *     raise.
 *
 * base64 inflates by a third, so a three-minute AAC note crossed both. The
 * client now uploads the blob straight to Storage with the browser Supabase
 * client — the code-auth JWT carries `role: 'authenticated'`, so the
 * `staff upload call recordings` policy (`app.is_staff(<first path segment>)`)
 * applies exactly as it does server-side — and this action only records that
 * it happened.
 *
 * ORDERING IS LOAD-BEARING: upload first, insert second. A row pointing at
 * audio that does not exist is unrecoverable — the transcribe webhook fires,
 * fails to sign a URL, and the call looks transcribed-and-empty forever. An
 * uploaded object with no row is merely an orphan in a private bucket.
 *
 * Attribution stays server-side and follows the §5.9 paired-column rule: a
 * team session writes `uploaded_by_staff`, an admin writes `uploaded_by`.
 * Never both — that is what the CHECK constraints exist to prevent.
 */
export async function registerVoiceNote(input: {
  eventId: string
  eventCode: string
  groupId: string
  callAttemptId: string
  /** Storage path the client already uploaded to, inside the call-recordings bucket. */
  storagePath: string
  /** The real content type of the uploaded object. */
  mimeType: string
  durationSec: number
}): Promise<RegisterVoiceNoteResult> {
  const claims = await readSessionClaims()

  const { data: { user } } = await supabase.auth.getUser()
  const staffMemberId = claims?.staffMemberId ?? null

  if (!user && !staffMemberId) {
    return { ok: false, error: 'No staff identity is selected. Pick who you are, then try again.' }
  }

  // The bucket policy fences on the first path segment being an event the
  // caller is staff on. Re-assert it here so a crafted path cannot file a
  // recording under one event while claiming another.
  if (!input.storagePath.startsWith(`${input.eventId}/`)) {
    return { ok: false, error: 'That recording was stored under the wrong event and was not filed.' }
  }

  const { data: inserted, error: insertError } = await supabase
    .from('call_recordings')
    .insert({
      event_id: input.eventId,
      group_id: input.groupId,
      call_attempt_id: input.callAttemptId,
      storage_bucket: 'call-recordings',
      storage_path: input.storagePath,
      duration_sec: input.durationSec,
      mime_type: input.mimeType,
      source: 'voice_note',
      consent_given: true,
      ...(staffMemberId
        ? { uploaded_by: null, uploaded_by_staff: staffMemberId }
        : { uploaded_by: user?.id ?? null, uploaded_by_staff: null }),
    })
    .select('id')
    .single()

  if (insertError) {
    const diagnostic =
      `step=registerVoiceNote code=${insertError.code ?? 'unknown'} ` +
      `event=${input.eventId.slice(0, 8)} group=${input.groupId.slice(0, 8)} at=${new Date().toISOString()}`
    console.error('[registerVoiceNote] insert failed', {
      sqlstate: insertError.code,
      message: insertError.message?.slice(0, 200),
      eventId: input.eventId,
      groupId: input.groupId,
      storagePath: input.storagePath,
    })
    return { ok: false, error: `Could not save recording: ${insertError.message}`, diagnostic }
  }

  // The review queue is fed by this row's downstream transcript/extraction, and
  // the call screen lists recordings for the family.
  return { ok: true, recordingId: inserted.id }
}
