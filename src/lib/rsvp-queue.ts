/**
 * The Calling screen's filter + outcome vocabulary, as pure functions.
 *
 * WHY THIS FILE EXISTS. The queue screen, the "all families" sheet and the
 * status word on a row all have to agree on two things: which chip a family
 * belongs to, and which `rsvp_status` a logged outcome writes. They used to
 * keep their own copies of both - a switch in `CallNext.tsx`, a chip list in
 * `FamilyQueueSheet.tsx`, a third status map in `AllContacts.tsx` - and the
 * copies disagreed. "Not coming" swallowed `unreachable`, so a No answer chip
 * could not exist without double-counting it into "Not coming"; and no chip
 * carried a number, so a tap that reordered the list read as a tap that did
 * nothing.
 *
 * Everything here is pure and DOM-free, so `tests/rsvp-queue.test.ts` can pin
 * the mapping without a React renderer or a database.
 */

import type { CallOutcome } from '@/lib/call/types'
import type { RsvpStatus } from '@/lib/rsvp-log'

/** The chips on the Calls screen. */
export type FilterChipId = 'to_call' | 'coming' | 'not_coming' | 'no_answer' | 'callback' | 'all'

export interface FilterChip {
  id: FilterChipId
  label: string
}

/**
 * Chip order is the calling funnel, not alphabetical: the next action first,
 * the settled answers next, and "All" as the escape hatch at the end.
 */
export const FILTER_CHIPS: readonly FilterChip[] = [
  { id: 'to_call', label: 'To call' },
  { id: 'coming', label: 'Coming' },
  { id: 'not_coming', label: 'Not coming' },
  { id: 'no_answer', label: 'No answer' },
  { id: 'callback', label: 'Call back' },
  { id: 'all', label: 'All' },
]

/** The two columns a filter reads. A view row and a cached row both satisfy it. */
export interface FilterableRow {
  rsvp_status: string | null
  next_callback_at: string | null
}

/**
 * Which chip a family belongs to.
 *
 * `attempted` deliberately appears under BOTH `to_call` and `no_answer`. A
 * family that was dialled and never picked up still needs calling, so it must
 * not drop out of the working list; and it is also the honest answer to "who
 * has not been reached". The chips are lenses over one list, not a partition
 * of it - which is why every chip carries its own number rather than the
 * screen assuming they sum to the total.
 */
export function matchesFilter(filter: FilterChipId, row: FilterableRow): boolean {
  const status = row.rsvp_status
  switch (filter) {
    case 'to_call':
      return !status || status === 'not_started' || status === 'attempted'
    case 'coming':
      return status === 'confirmed' || status === 'tentative'
    case 'not_coming':
      return status === 'declined'
    case 'no_answer':
      return status === 'unreachable' || status === 'attempted'
    case 'callback':
      return status === 'callback' || row.next_callback_at !== null
    case 'all':
      return true
  }
}

/** The rows under one chip, in the order the view returned them. */
export function filterRows<T extends FilterableRow>(rows: readonly T[], filter: FilterChipId): T[] {
  return rows.filter((row) => matchesFilter(filter, row))
}

/** The number on every chip. One pass over the rows, one object keyed by chip. */
export function filterCounts(rows: readonly FilterableRow[]): Record<FilterChipId, number> {
  const counts: Record<FilterChipId, number> = {
    to_call: 0,
    coming: 0,
    not_coming: 0,
    no_answer: 0,
    callback: 0,
    all: 0,
  }

  for (const row of rows) {
    for (const chip of FILTER_CHIPS) {
      if (matchesFilter(chip.id, row)) counts[chip.id] += 1
    }
  }

  return counts
}

/** The five things a caller can record, as the outcome buttons offer them. */
export type OutcomeKey = 'coming' | 'not_coming' | 'no_answer' | 'maybe' | 'callback'

export interface OutcomeDefinition {
  /** The family's `rsvp_status` once this outcome is saved. */
  status: RsvpStatus
  /** The `call_attempts.outcome` (enum `app.call_outcome`) written alongside it. */
  callOutcome: CallOutcome
  /** The chip this family lands under afterwards. */
  chip: FilterChipId
  /** What the Undo bar says. */
  label: string
}

/**
 * The ONE outcome -> status mapping.
 *
 * Every outcome writes a definite status. There is deliberately no entry that
 * leaves a family on `not_started`: a saved call that moved nobody is exactly
 * the "the status did not update" the Calling screen shipped with, and an
 * optimistic patch keyed on this table cannot drift from the write because
 * both read the same row.
 *
 * `callback` also carries `callback_at` (set by the form and written by
 * `save_rsvp_log`); the queue reads it back through `next_callback_at`, which
 * coalesces `guest_groups.callback_at` with the frozen attempt's own time.
 */
export const OUTCOME_DEFINITIONS: Record<OutcomeKey, OutcomeDefinition> = {
  coming: { status: 'confirmed', callOutcome: 'connected', chip: 'coming', label: 'Coming' },
  not_coming: {
    status: 'declined',
    callOutcome: 'declined',
    chip: 'not_coming',
    label: 'Not coming',
  },
  no_answer: {
    status: 'unreachable',
    callOutcome: 'no_answer',
    chip: 'no_answer',
    label: 'No answer',
  },
  maybe: { status: 'tentative', callOutcome: 'connected', chip: 'coming', label: 'Maybe' },
  callback: { status: 'callback', callOutcome: 'callback', chip: 'callback', label: 'Call back' },
}

/** The definition for one outcome key. */
export function outcomeDefinition(key: OutcomeKey): OutcomeDefinition {
  return OUTCOME_DEFINITIONS[key]
}