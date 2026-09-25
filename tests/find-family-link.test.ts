import { describe, expect, it } from 'vitest'

import { STAFF_DEPARTMENTS, mayOpenCallRecords, type StaffDepartment } from '@/lib/departments'

/**
 * "Open the family record" on the guest sheet (`docs/BUGS.md` M3).
 *
 * The search button sits in EVERY header, so all six departments reach Find and
 * its guest sheet. The record it links to is behind `requireSection(..., 'rsvp')`
 * — management and admins only — so the button bounced hospitality, travel,
 * hamper and production runners back to their own board with a
 * `?denied=section` marker those boards do not render. A maroon primary button
 * that silently does nothing is the worst version of this, which is why the
 * answer is resolved on the server and passed down rather than guessed.
 */
describe('mayOpenCallRecords', () => {
  it('lets an admin and management open a family record', () => {
    expect(mayOpenCallRecords('admin', 'management')).toBe(true)
    expect(mayOpenCallRecords('event_team', 'management')).toBe(true)
  })

  it('refuses every department whose home is not the call list', () => {
    for (const department of ['logistics', 'hospitality', 'hamper', 'production'] as StaffDepartment[]) {
      expect(mayOpenCallRecords('event_team', department), department).toBe(false)
    }
  })

  it('refuses a skipped-name session, which the RSVP guard also refuses', () => {
    expect(mayOpenCallRecords('event_team', null)).toBe(false)
  })

  it('says yes for exactly the departments the RSVP section admits', () => {
    // A8 added the rsvp department, whose whole job IS the call records, so it
    // joins management as a department the RSVP section admits.
    for (const department of [...STAFF_DEPARTMENTS, null] as (StaffDepartment | null)[]) {
      expect(mayOpenCallRecords('event_team', department)).toBe(
        department === 'management' || department === 'rsvp',
      )
    }
  })
})
