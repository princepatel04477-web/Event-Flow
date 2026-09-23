'use client'

import { StaffGuestDirectory } from '../guests/_components/StaffGuestDirectory'

export interface FindStaffProps {
  eventId: string
  eventCode: string
}

/**
 * Find, for staff and admins.
 *
 * THE SCREEN NOW LIVES IN ONE PLACE. SPEC-V3 §3 makes Guests and Find the same
 * thing behind two doors — "Guests / Find = the search button in every header"
 * — so the directory (search field, Rows, guest sheet) is implemented once, in
 * `guests/_components/`, and this route renders it. Everything this file used
 * to hold is still here in behaviour: the server-side bounded read, the 250ms
 * debounce, T4's "typing never blanks the results", the offline-is-a-state
 * branch, and the rule that a result opens the family record only when the
 * read that found it knew the family id.
 *
 * The alternative — a second copy for Find — is how the two doors end up
 * showing two different-looking searches for the same data, which is the
 * failure the old shared `FindParts` existed to prevent and this removes the
 * possibility of.
 */
export function FindStaff({ eventId, eventCode }: FindStaffProps) {
  return <StaffGuestDirectory eventId={eventId} eventCode={eventCode} from="find" />
}

export default FindStaff
