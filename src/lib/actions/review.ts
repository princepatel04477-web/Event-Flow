import { revalidatePath } from 'next/cache'

import { supabase } from '@/lib/supabase/client'
import type { Json } from '@/lib/supabase/database.types'
import { friendlyRpcError } from '@/lib/errors'
import type { RpcPayload } from '@/lib/review/payload'

export type ReviewActionResult = { ok: true } | { ok: false; error: string }

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

  const { error } = await supabase.rpc('apply_rsvp_extraction', {
    p_extraction_id: extractionId,
    // RpcPayload is a plain JSON-shaped object; the generated Args type
    // wants `Json`, which its structure already satisfies.
    p_payload: payload as unknown as Json,
  })

  if (error) {
    return { ok: false, error: friendlyRpcError(error) }
  }
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

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, error: 'Your session has expired. Sign in again and retry.' }
  }

  // `.eq('status', 'pending')` is the concurrency guard, not decoration.
  // Without it a reviewer holding a stale page could flip an extraction that
  // another reviewer had already ACCEPTED to `rejected` — writing their own
  // rejection notes over it while the accepted extraction's real effects
  // stayed live in guest_groups and travel_legs. The update must only ever
  // match a row still awaiting review.
  const { data, error } = await supabase
    .from('rsvp_extractions')
    .update({
      status: 'rejected',
      review_notes: notes,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', extractionId)
    .eq('status', 'pending')
    .select('id')

  if (error) {
    return { ok: false, error: 'Could not reject this extraction. Try again.' }
  }

  // event_team updates that RLS blocks return 0 rows, not an error — never
  // read the absence of an error as success. Zero rows here means one of:
  // not permitted, the extraction is gone, or (now genuinely reachable) it
  // is no longer pending because someone else reviewed it first.
  if (!data || data.length === 0) {
    const { data: current } = await supabase
      .from('rsvp_extractions')
      .select('status, reviewed_at')
      .eq('id', extractionId)
      .maybeSingle()

    if (current && current.status !== 'pending') {
      return {
        ok: false,
        error:
          current.status === 'accepted'
            ? 'Someone else already accepted this extraction, and accepting it applied real changes to guest data. It cannot be rejected now — refresh to see what was applied.'
            : `Someone else already reviewed this extraction (status: ${current.status}). Refresh the review queue.`,
      }
    }

    return {
      ok: false,
      error: 'Nothing was updated — you may not have permission to review this extraction.',
    }
  }
  return { ok: true }
}
