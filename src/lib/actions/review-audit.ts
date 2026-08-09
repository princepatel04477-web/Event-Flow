'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { getSessionClaims } from '@/lib/auth/server'
import type { Json } from '@/lib/supabase/database.types'
import { friendlyRpcError } from '@/lib/errors'
import type { RpcPayload } from '@/lib/review/payload'

export type ReviewActionResult = { ok: true } | { ok: false; error: string }

/**
 * One per-field decision on an extraction, exactly the shape of the
 * `extraction_field_reviews` insert-only audit table (migration 1700).
 */
export interface FieldReviewDecision {
  /** Dotted field key matching the CONFIDENCE_PATHS convention. */
  fieldName: string
  /** The model's value for this field (may be null when the model was silent). */
  aiValue: Json | null
  /** The value that actually entered guest data (null when the field was rejected). */
  finalValue: Json | null
  action: 'accepted' | 'edited' | 'rejected'
}

/**
 * Accept a reviewed extraction. TWO writes, in order, each with its own
 * concern:
 *
 * 1. `apply_rsvp_extraction()` — the ONLY path from AI output into guest
 *    data (CLAUDE.md §5.8). Applies the payload to guest_groups + travel_legs
 *    in one security-definer transaction and clears the caller lock.
 * 2. `extraction_field_reviews` — the insert-only per-field audit trail
 *    proving a human signed off on every value, and the corpus S6 retrieves
 *    from. Insert-only, so a mistake here cannot be edited away later.
 *
 * Attribution: code-auth (team) sessions have NO auth.uid() — the identity
 * is the selected staff member from the picker. Resolve it the same way
 * proof.ts does, so reviewed_by / reviewed_by_staff never double-set
 * (the table's CHECK enforces exactly one).
 *
 * Ordering matters: the audit rows are written AFTER the RPC succeeds. An
 * extraction that applied real changes to guest data but lost its audit
 * trail is a worse state than a draft extraction with no audit rows.
 */
export async function acceptExtractionWithAudit(
  eventCode: string,
  extractionId: string,
  payload: RpcPayload,
  fieldReviews: FieldReviewDecision[],
): Promise<ReviewActionResult> {
  const supabase = await createClient()

  const claims = await getSessionClaims()
  const staffMemberId = claims?.staffMemberId ?? null

  // The audit insert needs a reviewed_by / reviewed_by_staff value. A code
  // session without a selected staff member is a broken session — refuse
  // before the RPC fires, so a successful apply can never orphan its audit.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user && !staffMemberId) {
    return { ok: false, error: 'No staff identity is selected. Pick who you are, then review again.' }
  }

  // 1. Apply — the proven commit path. If this fails, nothing else runs and
  //    no audit rows are written for a change that never happened.
  const { error } = await supabase.rpc('apply_rsvp_extraction', {
    p_extraction_id: extractionId,
    p_payload: payload as unknown as Json,
  })

  if (error) {
    return { ok: false, error: friendlyRpcError(error) }
  }

  // 2. Audit — insert-only per-field sign-off. The extract writes the whole
  //    batch in one statement; a partial failure (e.g. RLS) reports as an
  //    error but the guest data has already been applied, so the message
  //    says exactly that rather than pretending the review did nothing.
  if (fieldReviews.length > 0) {
    const { data: scoped } = await supabase
      .from('rsvp_extractions')
      .select('event_id')
      .eq('id', extractionId)
      .maybeSingle()

    if (!scoped) {
      return {
        ok: false,
        error:
          'The extraction was applied, but its event could not be read to record the audit. Refresh the review queue — the guest data is updated.',
      }
    }

    // Code session: attribute to the selected staff member (reviewed_by
    // stays null — the CHECK rejects a row with both set). Admin: the real
    // auth uid. Same resolution as proof.ts. Each row is built as one object
    // so the split-column pair never double-sets.
    const rows = fieldReviews.map((r) => {
      const row = {
        event_id: scoped.event_id,
        extraction_id: extractionId,
        field_name: r.fieldName,
        ai_value: r.aiValue,
        final_value: r.finalValue,
        action: r.action,
      } as Record<string, unknown>
      if (staffMemberId) {
        row.reviewed_by = null
        row.reviewed_by_staff = staffMemberId
      } else {
        row.reviewed_by = user?.id ?? null
        row.reviewed_by_staff = null
      }
      return row
    })

    const { error: auditError } = await supabase.from('extraction_field_reviews').insert(
      rows as never,
    )

    if (auditError) {
      return {
        ok: false,
        error:
          'Guest data was updated, but the per-field review trail could not be recorded. Tell your admin — the extraction is applied, the audit is missing.',
      }
    }
  }

  revalidatePath(`/${eventCode}/review`)
  revalidatePath(`/${eventCode}/review/${extractionId}`)
  revalidatePath(`/${eventCode}`)
  revalidatePath(`/${eventCode}/queue`)

  return { ok: true }
}
