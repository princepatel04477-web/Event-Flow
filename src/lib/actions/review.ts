'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import type { Json } from '@/lib/supabase/database.types'
import type { RpcPayload } from '@/lib/review/payload'

export type ReviewActionResult = { ok: true } | { ok: false; error: string }

type MaybePostgrestError = {
  message?: string
  code?: string
}

/**
 * Map raw Postgres/PostgREST failures onto sentences a reviewer can act on.
 * Never surface a raw error — a cast failure on an enum column reads like
 * gibberish to someone reviewing a phone call in a corridor.
 */
function friendlyRpcError(error: MaybePostgrestError): string {
  const message = (error.message ?? '').toLowerCase()

  if (message.includes('already been applied')) {
    return 'This extraction has already been applied. Refresh the review queue.'
  }
  if (message.includes('lock_not_available') || message.includes('locked by another')) {
    return 'This group is locked by another caller right now. Try again shortly.'
  }
  if (error.code === '42501' || message.includes('not permitted')) {
    return 'You do not have permission to apply this extraction.'
  }
  if (message.includes('invalid input value for enum')) {
    return 'One of the fields has a value the database does not recognise. Check the RSVP status and side fields.'
  }
  if (message.includes('invalid input syntax for type integer')) {
    return 'Confirmed pax or a leg’s pax must be a whole number.'
  }
  if (message.includes('fetch failed') || message.includes('network')) {
    return 'Could not reach the server. Check your connection and try again.'
  }

  return 'Could not save this review. Try again in a moment.'
}

/**
 * Accept a reviewed extraction: apply_rsvp_extraction() is the ONLY path
 * from AI output into guest data. On success it also clears the group's
 * caller lock, so the family becomes claimable again.
 */
export async function acceptExtraction(
  eventCode: string,
  extractionId: string,
  payload: RpcPayload,
): Promise<ReviewActionResult> {
  const supabase = await createClient()

  const { error } = await supabase.rpc('apply_rsvp_extraction', {
    p_extraction_id: extractionId,
    // RpcPayload is a plain JSON-shaped object; the generated Args type
    // wants `Json`, which its structure already satisfies.
    p_payload: payload as unknown as Json,
  })

  if (error) {
    return { ok: false, error: friendlyRpcError(error) }
  }

  revalidatePath(`/${eventCode}/review`)
  revalidatePath(`/${eventCode}/review/${extractionId}`)
  revalidatePath(`/${eventCode}`)
  revalidatePath(`/${eventCode}/queue`)

  return { ok: true }
}

/**
 * Reject an extraction: write status + review_notes only. Nothing here
 * touches guest_groups or travel_legs — rejecting writes nothing to guest
 * data, by construction (this is a plain table update, not the RPC).
 */
export async function rejectExtraction(
  eventCode: string,
  extractionId: string,
  reviewNotes: string,
): Promise<ReviewActionResult> {
  const notes = reviewNotes.trim()
  if (!notes) {
    return { ok: false, error: 'Add a short note explaining why this is being rejected.' }
  }

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, error: 'Your session has expired. Sign in again and retry.' }
  }

  const { data, error } = await supabase
    .from('rsvp_extractions')
    .update({
      status: 'rejected',
      review_notes: notes,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', extractionId)
    .select('id')

  if (error) {
    return { ok: false, error: 'Could not reject this extraction. Try again.' }
  }

  // event_team deletes/updates that RLS blocks return 0 rows, not an error —
  // never read the absence of an error as success.
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: 'Nothing was updated — you may not have permission, or someone else already reviewed this.',
    }
  }

  revalidatePath(`/${eventCode}/review`)
  revalidatePath(`/${eventCode}/review/${extractionId}`)

  return { ok: true }
}
