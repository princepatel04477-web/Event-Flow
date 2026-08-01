'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import type { Json } from '@/lib/supabase/database.types'
import { friendlyDbError, friendlyRpcError } from '@/lib/errors'
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
  // A blank note is allowed and gets a default. Discard is the caller's
  // escape hatch for "that is not what they said" — putting a required text
  // field in front of it, on a phone, in a corridor, is how you get people
  // accepting a wrong extraction because it was the quicker button.
  const notes = reviewNotes.trim() || 'Discarded at review — details re-entered manually.'

  const supabase = await createClient()

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

  revalidatePath(`/${eventCode}/review`)
  revalidatePath(`/${eventCode}/review/${extractionId}`)

  return { ok: true }
}

/**
 * Commit a manually typed RSVP — the path taken when a caller discards an
 * extraction, or when there was never a recording to extract from.
 *
 * It routes through `apply_rsvp_extraction()` rather than updating
 * `guest_groups` and `travel_legs` directly, for three reasons the direct
 * path cannot give us: the group and its legs land in one transaction, the
 * caller's lock is released by the same statement that writes the data, and
 * the entry is auditable afterwards as a row someone typed (`model` is
 * `'manual'`) rather than an unattributable UPDATE.
 *
 * The insert and the RPC are two round trips, so a failure between them
 * leaves a `pending` extraction with `model = 'manual'` behind. That row is
 * inert — it has written nothing to guest data — but it will appear in the
 * review queue until someone applies or discards it.
 */
export async function applyManualEntry(
  eventCode: string,
  eventId: string,
  groupId: string,
  payload: RpcPayload,
): Promise<ReviewActionResult> {
  const supabase = await createClient()

  const { data: extraction, error: insertError } = await supabase
    .from('rsvp_extractions')
    .insert({
      event_id: eventId,
      group_id: groupId,
      // The payload is already in RPC shape, and the RPC overwrites `parsed`
      // with what it was handed anyway — so what lands here is exactly what
      // the human typed.
      parsed: payload as unknown as Json,
      confidence: {} as unknown as Json,
      model: 'manual',
    })
    .select('id')
    .single()

  if (insertError || !extraction) {
    return { ok: false, error: friendlyDbError(insertError) }
  }

  const { error } = await supabase.rpc('apply_rsvp_extraction', {
    p_extraction_id: extraction.id,
    p_payload: payload as unknown as Json,
  })

  if (error) {
    return { ok: false, error: friendlyRpcError(error) }
  }

  revalidatePath(`/${eventCode}/review`)
  revalidatePath(`/${eventCode}`)
  revalidatePath(`/${eventCode}/queue`)

  return { ok: true }
}
