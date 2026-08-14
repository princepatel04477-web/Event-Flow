'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'

/**
 * Staff members — now attribution only, not a gate.
 *
 * HISTORY, because the code reads oddly without it. Every insert/update policy
 * on 18 tables used to be `app.is_staff(event_id) AND
 * app.has_staff_identity(event_id)`, where the second half required a
 * `staff_member_id` JWT claim minted by tapping a name on /pick-staff. An event
 * with no staff rows was fully readable and completely unwritable, and from a
 * phone that did not look like a permission problem: the screen loaded, the
 * form submitted, the spinner never stopped. SHARMA26 shipped in that state.
 *
 * Migration 20260814140000 removed the gate at the owner's instruction. Writes
 * no longer require an identity, so this module no longer unblocks anything.
 * What it still does is make attribution POSSIBLE: with a name bound, the
 * `_staff` sibling columns (caller_id_staff, captured_by_staff, ...) are filled
 * by `app.route_attribution`; without one they stay null and "who did this" has
 * no answer. delivery_proofs are insert-only and immutable, so an unattributed
 * proof can never be corrected — this is not something to fix up after the
 * event.
 *
 * Writes here are admin-only and the DATABASE is the fence —
 * `staff_members_ins with check (app.is_admin())`, same for update and
 * delete. There is deliberately no TypeScript permission check, matching
 * access-codes.ts: the admin route group is a UX affordance, not a boundary.
 */

/** Postgres insufficient_privilege — RLS refused the row. */
const RLS_DENIED = '42501'

/** Postgres unique violation. */
const UNIQUE_VIOLATION = '23505'

export type StaffActionResult = { ok: true } | { ok: false; error: string }

const nameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a name.')
  // The name is what a caller taps to say "I am this person", and it is what
  // every attribution column resolves to on an export. Two people called
  // "Ravi" are indistinguishable in the ledger, so ask for enough to tell
  // them apart — but do not enforce a surname, because plenty of staff go by
  // one name and a validator that refuses a real name is worse than an
  // ambiguous ledger.
  .max(80, 'Keep the name to 80 characters or fewer.')

/**
 * Add one staff member to an event.
 *
 * `is_active` defaults to true in the schema, so a new name is immediately
 * pickable — which is the point: the admin is usually adding it because
 * somebody is standing there unable to log a call.
 */
export async function createStaffMember(
  eventId: string,
  eventCode: string,
  rawName: string,
): Promise<StaffActionResult> {
  const parsed = nameSchema.safeParse(rawName)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Enter a name.' }
  }

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { ok: false, error: 'Your session has expired. Sign in again and retry.' }
  }

  const { error } = await supabase.from('staff_members').insert({
    event_id: eventId,
    full_name: parsed.data,
    created_by: user.id,
  })

  if (error) {
    if (error.code === RLS_DENIED) {
      return { ok: false, error: 'Only an admin can add staff to an event.' }
    }
    if (error.code === UNIQUE_VIOLATION) {
      return { ok: false, error: 'Someone with that exact name is already on this event.' }
    }
    return { ok: false, error: error.message }
  }

  revalidateStaff(eventCode)
  return { ok: true }
}

/**
 * Deactivate or reactivate a staff member.
 *
 * Never a delete. `staff_members.id` is the target of an `ON DELETE RESTRICT`
 * foreign key from every `_staff` attribution column in the schema
 * (`caller_id_staff`, `captured_by_staff`, `locked_by_staff`, ...), so
 * deleting someone who has ever done anything is refused by the database —
 * and rightly: "who logged this call" must stay answerable after they go
 * home. Deactivating removes them from /pick-staff without touching history.
 */
export async function setStaffMemberActive(
  staffId: string,
  eventCode: string,
  isActive: boolean,
): Promise<StaffActionResult> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('staff_members')
    .update({ is_active: isActive })
    .eq('id', staffId)

  if (error) {
    if (error.code === RLS_DENIED) {
      return { ok: false, error: 'Only an admin can change the staff list.' }
    }
    return { ok: false, error: error.message }
  }

  revalidateStaff(eventCode)
  return { ok: true }
}

/**
 * The staff list is read by the admin screen AND by /pick-staff, and a stale
 * picker is the failure this whole module exists to prevent — an admin adds a
 * name, the caller refreshes, and the list is still empty.
 */
function revalidateStaff(eventCode: string) {
  revalidatePath(`/admin/events/${eventCode}/staff`)
  revalidatePath(`/admin/events/${eventCode}`)
  revalidatePath('/pick-staff')
}
