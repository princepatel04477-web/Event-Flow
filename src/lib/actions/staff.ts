'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'

/**
 * Staff members — the identity that every write in this app is gated on.
 *
 * `app.has_staff_identity(event_id)` reads the `staff_member_id` claim off the
 * session JWT, and EVERY insert/update policy in the schema ANDs it with
 * `app.is_staff(event_id)`: hotels, rooms, guests, guest_groups,
 * import_batches, import_rows, trips, vehicles, deliverables, travel_legs,
 * room_assignments, call_attempts, call_recordings, transcripts,
 * rsvp_extractions, messages. Eighteen tables, no exceptions.
 *
 * That claim is only minted when someone taps their name on /pick-staff, and
 * that list is `staff_members` for the event. So an event with no staff rows
 * is an event where every read works perfectly and every single write is
 * refused by RLS — which from a phone does not look like a permission problem
 * at all. The screen loads, the form submits, the spinner never stops.
 *
 * SHARMA26 shipped in exactly that state. Until this module there was no code
 * path anywhere in the app that inserted a `staff_members` row: the admin
 * dashboard warned "add at least one name" and pointed nowhere, and
 * /pick-staff offered an admin a button to `/admin/events/<code>/staff`, a
 * route that did not exist. The two live staff rows on SAMPLE2026 were
 * inserted by hand against the database.
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
