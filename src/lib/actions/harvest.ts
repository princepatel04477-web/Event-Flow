'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { getSessionClaims } from '@/lib/auth/server'
import { r2BucketValue } from '@/lib/media/names'

export type RegisterHarvestedResult =
  | { ok: true; recordingId: string }
  | { ok: false; error: string; /** `step=… code=… at=…`, for Sentry. Never shown to staff. */ diagnostic?: string }

/**
 * Insert the `call_recordings` row for an already-uploaded harvested file.
 *
 * WHY THE AUDIO DOES NOT COME THROUGH HERE
 *
 * The previous `uploadHarvestedRecording` took the whole file as base64 in the
 * server-action body, which cannot ship: Next's `serverActions.bodySizeLimit`
 * defaults to 1 MB, and base64 inflates by a third. An OEM dialer's recording
 * of a four-minute call clears that on its own. `registerVoiceNote` already
 * learned this the hard way; this is the same split — the client uploads the
 * bytes straight to Storage, and this action only records that it happened.
 *
 * ORDERING IS LOAD-BEARING: upload first, insert second. A row pointing at
 * audio that does not exist is unrecoverable, because `call_recordings` has
 * `no_update` and `no_delete` triggers — the row can never be corrected or
 * removed, and the transcribe webhook will fail to sign a URL forever. An
 * uploaded object with no row is merely an orphan in a private bucket.
 *
 * CONSENT IS NOT DECORATION. `transcribe-recording` refuses outright on
 * `consent_given = false` — verified against the live webhook responses, which
 * returned `{"skipped":"consent_missing"}` for every recording filed without
 * it. A row written without consent is audio that will never be transcribed
 * and, because the table is insert-only, can never be fixed. So this action
 * rejects rather than writing such a row.
 */
export async function registerHarvestedRecording(input: {
  eventId: string
  eventCode: string
  groupId: string
  /** Null when the call was dialled outside the app, so no attempt row exists. */
  callAttemptId: string | null
  /** Storage path the client already uploaded to, inside the call-recordings bucket. */
  storagePath: string
  /** The real content type of the uploaded object. */
  mimeType: string
  durationSec: number | null
  /** The staff attestation that the family was told the call is recorded. */
  consentGiven: boolean
}): Promise<RegisterHarvestedResult> {
  if (!input.consentGiven) {
    return {
      ok: false,
      error:
        'This recording has no consent on file, so it was not filed. ' +
        'Transcription refuses recordings without it, and the row could never be corrected afterwards.',
    }
  }

  const supabase = await createClient()
  const claims = await getSessionClaims()

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
      storage_bucket: r2BucketValue('eventflow-call-recordings'),
      storage_path: input.storagePath,
      duration_sec: input.durationSec,
      mime_type: input.mimeType,
      source: 'harvested',
      consent_given: true,
      ...(staffMemberId
        ? { uploaded_by: null, uploaded_by_staff: staffMemberId }
        : { uploaded_by: user?.id ?? null, uploaded_by_staff: null }),
    })
    .select('id')
    .single()

  if (insertError) {
    const diagnostic =
      `step=registerHarvestedRecording code=${insertError.code ?? 'unknown'} ` +
      `event=${input.eventId.slice(0, 8)} group=${input.groupId.slice(0, 8)} at=${new Date().toISOString()}`
    console.error('[registerHarvestedRecording] insert failed', {
      sqlstate: insertError.code,
      message: insertError.message?.slice(0, 200),
      eventId: input.eventId,
      groupId: input.groupId,
      storagePath: input.storagePath,
    })
    return { ok: false, error: `Could not save recording: ${insertError.message}`, diagnostic }
  }

  // The review queue is fed by this row's downstream transcript/extraction.
  revalidatePath(`/${input.eventCode}/rsvp/review`)
  revalidatePath(`/${input.eventCode}/rsvp/call/${input.groupId}`)

  return { ok: true, recordingId: inserted.id }
}
