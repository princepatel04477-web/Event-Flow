import { describe, it, expect } from 'vitest'

import {
  friendlyDbError,
  roomGuardCause,
  roomGuardCausePair,
  roomGuardCopy,
  roomGuardMessage,
} from '@/lib/errors'

/**
 * The two 23514 causes a room screen has to tell apart.
 *
 * WHY THIS FILE EXISTS. `app.guard_room_assignment()`
 * (`supabase/migrations/20260816150000_room_guard_row_lock.sql`) raises SQLSTATE
 * 23514 for THREE different reasons — the room is at its bed ceiling, the room
 * already holds an overlapping stay, or the dates are reversed — and only the
 * first is legitimately bypassable with a written `is_override` reason. Until
 * this classifier existed, every 23514 was read as "the room is full", which is
 * how the room grid came to answer an overlap with a capacity override sheet:
 * a control that cannot work, aimed at a person who has no way to know better
 * (CLAUDE.md §14, "Known product gap"; V10 Part A).
 *
 * The messages asserted below are verbatim from the trigger. Copying them here
 * is deliberate: if a migration rewords a RAISE, this test fails and the
 * classifier is looked at, which is the only thing standing between a reworded
 * trigger and a silent slide back to one message for two problems.
 *
 * Pure module, no database — `environment: 'node'` and no client.
 */

/** Exactly what the merged guard raises when `is_override` is not set. */
const CAPACITY = {
  code: '23514',
  message:
    'Room 204 is at max capacity (max 2, 2 overlapping stays currently). Set is_override with a reason to force.',
}

/** The date-range overlap branch. Raised unconditionally — no override exists. */
const OVERLAP = {
  code: '23514',
  message: 'Room 204 is already booked for an overlapping stay.',
}

/** Check-out before check-in. A typo in the dates, not a room problem. */
const DATE_ORDER = {
  code: '23514',
  message: 'Room 204 check-out 2026-12-20 is before check-in 2026-12-22.',
}

/** A CHECK violation that has nothing to do with the room guard. */
const OTHER_23514 = {
  code: '23514',
  message: 'new row for relation "room_assignments" violates check constraint "room_assignments_check"',
}

describe('roomGuardCause reads the trigger, not the SQLSTATE', () => {
  it('names the bed ceiling', () => {
    expect(roomGuardCause(CAPACITY)).toBe('capacity')
  })

  it('names an overlapping stay', () => {
    expect(roomGuardCause(OVERLAP)).toBe('overlap')
  })

  it('names reversed dates', () => {
    expect(roomGuardCause(DATE_ORDER)).toBe('date_order')
  })

  it('returns null for a 23514 that is not a room-guard refusal', () => {
    expect(roomGuardCause(OTHER_23514)).toBeNull()
  })

  it('returns null for anything that is not a 23514 at all', () => {
    expect(roomGuardCause({ code: '42501', message: 'Room 204 is at max capacity' })).toBeNull()
    expect(roomGuardCause(null)).toBeNull()
    expect(roomGuardCause(undefined)).toBeNull()
  })

  it('is case-insensitive, because PostgREST lowercases details in places', () => {
    expect(roomGuardCause({ code: '23514', message: 'ROOM 204 IS AT MAX CAPACITY' })).toBe(
      'capacity',
    )
  })
})

describe('only the bed ceiling is an override case', () => {
  it('folds an overlap into other, so it can never reach an override sheet', () => {
    expect(roomGuardCausePair(OVERLAP)).toBe('other')
  })

  it('folds reversed dates into other too', () => {
    expect(roomGuardCausePair(DATE_ORDER)).toBe('other')
  })

  it('keeps capacity as capacity', () => {
    expect(roomGuardCausePair(CAPACITY)).toBe('capacity')
  })

  it('passes null through, so a caller keeps its own fallback', () => {
    expect(roomGuardCausePair(null)).toBeNull()
  })
})

describe('the two causes do not share a sentence', () => {
  it('says different things for capacity and for overlap', () => {
    const capacity = roomGuardCopy('capacity', { roomNumber: '204' })
    const overlap = roomGuardCopy('overlap', { roomNumber: '204' })
    expect(capacity).not.toBe(overlap)
  })

  it('names the room the runner walked to', () => {
    expect(roomGuardCopy('capacity', { roomNumber: '204' })).toContain('Room 204')
    expect(roomGuardCopy('overlap', { roomNumber: '204' })).toContain('Room 204')
  })

  it('offers the override on capacity and denies it on overlap', () => {
    // The whole point of the distinction, stated as copy: one cause has a way
    // through and the other genuinely does not.
    expect(roomGuardCopy('capacity', { roomNumber: '204' })).toMatch(/written reason/i)
    expect(roomGuardCopy('overlap', { roomNumber: '204' })).toMatch(/no way to force/i)
  })

  it('never mentions capacity when the room is double-booked on dates', () => {
    const overlap = roomGuardCopy('overlap', { roomNumber: '204' })
    expect(overlap.toLowerCase()).not.toContain('capacity')
    expect(overlap.toLowerCase()).not.toContain('full')
  })

  it('falls back to a bare noun when the room number is unknown', () => {
    expect(roomGuardCopy('capacity')).toContain('That room')
  })
})

describe('roomGuardMessage is the cause-first entry point', () => {
  it('returns null on a null cause, so the caller keeps its fallback', () => {
    expect(roomGuardMessage(null, { roomNumber: '204' })).toBeNull()
  })

  it('returns the same copy as roomGuardCopy', () => {
    expect(roomGuardMessage('overlap', { roomNumber: '204' })).toBe(
      roomGuardCopy('overlap', { roomNumber: '204' }),
    )
  })
})

describe('the shared fallback is untouched by the new classifier', () => {
  it('still gives friendlyDbError nothing specific to say about a 23514', () => {
    // v1 renders this. The classifier is additive on purpose: nothing in
    // `friendlyDbError` learned about room causes, so a legacy screen shows
    // exactly the sentence it showed before this session.
    expect(friendlyDbError(CAPACITY)).toBe(
      'Something went wrong saving that. Try again in a moment.',
    )
    expect(friendlyDbError(OVERLAP)).toBe(
      'Something went wrong saving that. Try again in a moment.',
    )
  })
})
