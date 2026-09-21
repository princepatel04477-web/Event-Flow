import { describe, it, expect } from 'vitest'

import { lockNote, type StaffNameLookup } from '@/lib/lock'

/**
 * The caller lock, as a runner reads it.
 *
 * WHY THIS FILE EXISTS. CLAUDE.md §11b: a caller's phone dying mid-RSVP leaves
 * a family uneditable for 15 minutes, migration `20260813000000` removed the
 * admin's ability to clear someone else's lock, so `locked_until` expiry is the
 * ONLY recovery mechanism there is. V10 Part C fixes the half that does not need
 * a migration — being able to SEE the lock — and that half is entirely about
 * what the screen says: who holds it, and the exact minute it clears. Before
 * this, the card said "Another caller has this family open" and named neither.
 *
 * The three cases that matter are pinned here:
 *
 *   1. a live lock names the holder and the clear time;
 *   2. a holder whose id does not resolve to a person is said out loud as
 *      "Another phone" rather than guessed at (an admin session locks through
 *      `guest_groups.locked_by`, an auth uid with no `staff_members` row);
 *   3. a lock that has ALREADY EXPIRED is not rendered as a live lock — the
 *      queue can be a `staleTime` old, and "locked until 21:47" shown at 21:52
 *      sends a runner away from a family that is free.
 *
 * Pure function, no DOM, no Supabase: `environment: 'node'`.
 */

const names: StaffNameLookup = {
  nameOf: (id) => (id === 'staff-ravi' ? 'Ravi Patel' : null),
}

/** A fixed instant, so the assertions do not depend on when the suite runs. */
const NOW = Date.parse('2026-09-22T21:40:00.000Z')

/** A local-time label for an instant, produced the same way the module does. */
function localHm(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

describe('a live lock', () => {
  const until = '2026-09-22T21:47:00.000Z'

  it('names the holder and the exact clear time', () => {
    const note = lockNote(
      { isLocked: true, lockedUntil: until, lockedByStaff: 'staff-ravi' },
      names,
      NOW,
    )
    expect(note).not.toBeNull()
    expect(note!.locked).toBe(true)
    expect(note!.holder).toBe('Ravi Patel')
    expect(note!.clearAt).toBe(localHm(until))
    expect(note!.sentence).toContain('Ravi')
    expect(note!.sentence).toContain(localHm(until))
  })

  it('uses the first name, because that is what a runner says out loud', () => {
    const note = lockNote(
      { isLocked: true, lockedUntil: until, lockedByStaff: 'staff-ravi' },
      names,
      NOW,
    )
    expect(note!.sentence).toContain('Ravi already has')
    expect(note!.sentence).not.toContain('Ravi Patel already has')
  })

  it('says the family frees up on its own', () => {
    const note = lockNote({ isLocked: true, lockedUntil: until }, names, NOW)
    expect(note!.sentence).toMatch(/frees up on its own/)
  })
})

describe('a holder with no resolvable name', () => {
  it('is "Another phone" rather than a guess or a blank', () => {
    // An admin claims through `guest_groups.locked_by` (an auth uid). There is
    // no `staff_members` row for it, so there is genuinely no name to show.
    const note = lockNote(
      { isLocked: true, lockedUntil: '2026-09-22T21:47:00.000Z', lockedByStaff: null },
      names,
      NOW,
    )
    expect(note!.holder).toBe('Another phone')
    expect(note!.sentence).toContain('This family is open on another phone.')
  })

  it('still gives the clear time, which is the actionable half', () => {
    const note = lockNote(
      { isLocked: true, lockedUntil: '2026-09-22T21:47:00.000Z', lockedByStaff: 'unknown-id' },
      names,
      NOW,
    )
    expect(note!.clearAt).toBe(localHm('2026-09-22T21:47:00.000Z'))
  })

  it('does not promise a time it cannot read', () => {
    const note = lockNote(
      { isLocked: true, lockedUntil: null, lockedByStaff: 'staff-ravi' },
      names,
      NOW,
    )
    expect(note!.clearAt).toBeNull()
    expect(note!.sentence).toMatch(/shortly/)
    expect(note!.sentence).not.toMatch(/\d{2}:\d{2}/)
  })
})

describe('a lock the phone has already outlived', () => {
  const past = '2026-09-22T21:30:00.000Z'

  it('is not reported as a live lock', () => {
    const note = lockNote(
      { isLocked: true, lockedUntil: past, lockedByStaff: 'staff-ravi' },
      names,
      NOW,
    )
    expect(note!.locked).toBe(false)
    expect(note!.short).toMatch(/reload/i)
  })

  it('says so with an instruction, not with a stale time', () => {
    const note = lockNote(
      { isLocked: true, lockedUntil: past, lockedByStaff: 'staff-ravi' },
      names,
      NOW,
    )
    expect(note!.sentence).toMatch(/now run out/)
    expect(note!.sentence).toMatch(/reload/i)
    expect(note!.clearAt).toBeNull()
  })

  it('treats the exact expiry instant as expired', () => {
    // `locked_until > now()` is the view's own test, so equality is expired.
    const note = lockNote(
      { isLocked: true, lockedUntil: '2026-09-22T21:40:00.000Z', lockedByStaff: 'staff-ravi' },
      names,
      NOW,
    )
    expect(note!.locked).toBe(false)
  })
})

describe('no lock, nothing to say', () => {
  it('returns null when the view says it is not locked', () => {
    expect(lockNote({ isLocked: false, lockedUntil: null }, names, NOW)).toBeNull()
  })

  it('returns null when the column is missing entirely', () => {
    expect(lockNote({ isLocked: null, lockedUntil: null }, names, NOW)).toBeNull()
    expect(lockNote({ isLocked: undefined, lockedUntil: undefined }, names, NOW)).toBeNull()
  })

  it('treats an unreadable expiry as a standing lock rather than dropping it', () => {
    // A true `is_locked` with a garbage timestamp must not silently disappear:
    // saying nothing is how a frozen family reads as a normal one (§11b).
    const note = lockNote(
      { isLocked: true, lockedUntil: 'not-a-date', lockedByStaff: 'staff-ravi' },
      names,
      NOW,
    )
    expect(note!.locked).toBe(true)
    expect(note!.clearAt).toBeNull()
  })
})

describe('the row marker is short, the card is a sentence', () => {
  it('keeps the row form free of names and times', () => {
    const note = lockNote(
      { isLocked: true, lockedUntil: '2026-09-22T21:47:00.000Z', lockedByStaff: 'staff-ravi' },
      names,
      NOW,
    )
    expect(note!.short).not.toContain('Ravi')
    expect(note!.short).not.toMatch(/\d{2}:\d{2}/)
  })
})
