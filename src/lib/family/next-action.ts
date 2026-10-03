/**
 * The ONE primary action on a family's page (UI4 Part S, S4).
 *
 * The family page answers everything about one family, and its single big
 * button changes with where the family is in the event: call them, call them
 * back, check them in, deliver their hamper — or nothing, when the page is
 * just a record. Pure, so every row of the S4 table has a test.
 */

export type FamilyAction = 'call' | 'call-back' | 'check-in' | 'deliver-hamper' | null

export interface FamilyFacts {
  rsvpStatus: string | null
  /** A promised call-back time, if one is set. */
  callbackAt: string | null
  /** An arrival leg is dated today. */
  arrivingToday: boolean
  /** Any member holds a checked-in room. */
  checkedIn: boolean
  /** The family's hamper status, or null when it has none. */
  hamperStatus: string | null
}

/** What this viewer's department may do. The same gates the section guards use. */
export interface FamilyAbilities {
  canCall: boolean
  canCheckIn: boolean
  canDeliver: boolean
}

const NOT_YET_ANSWERED = new Set(['not_started', 'attempted', 'unreachable', 'pending', ''])

export function familyNextAction(f: FamilyFacts, can: FamilyAbilities): FamilyAction {
  const status = f.rsvpStatus ?? ''

  if (status === 'declined') return null

  if (status === 'callback' || (f.callbackAt && NOT_YET_ANSWERED.has(status))) {
    return can.canCall ? 'call-back' : null
  }

  if (NOT_YET_ANSWERED.has(status)) return can.canCall ? 'call' : null

  // Coming (confirmed / tentative): the event-day jobs, in the order they happen.
  if (f.arrivingToday && !f.checkedIn) return can.canCheckIn ? 'check-in' : null

  const hamperOpen = f.hamperStatus !== null && f.hamperStatus !== 'delivered' && f.hamperStatus !== 'not_required'
  if (f.checkedIn && hamperOpen) return can.canDeliver ? 'deliver-hamper' : null

  return null
}
