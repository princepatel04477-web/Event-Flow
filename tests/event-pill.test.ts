import { describe, expect, it } from 'vitest'

import { switchTarget } from '@/components/nav/EventPill'
import type { Membership } from '@/lib/events/paths'

const other = (role: Membership['role'] = 'event_team'): Membership => ({
  eventId: 'e2',
  eventCode: 'PATEL27',
  eventName: 'Patel wedding',
  role,
})

/** UI4 N9: switching event keeps you on the same tab. */
describe('switchTarget', () => {
  it('keeps the tab', () => {
    expect(switchTarget('/SHARMA26/rsvp/queue', other(), false)).toBe('/PATEL27/rsvp')
    expect(switchTarget('/SHARMA26/hospitality/rooms/12', other(), true)).toBe('/PATEL27/hospitality')
  })

  it('goes to the event root from Today', () => {
    expect(switchTarget('/SHARMA26', other(), false)).toBe('/PATEL27')
  })

  it('keeps Control for an admin, including from an admin tool screen', () => {
    expect(switchTarget('/SHARMA26/control', other(), true)).toBe('/PATEL27/control')
    expect(switchTarget('/admin/events/SHARMA26/codes', other(), true)).toBe('/PATEL27/control')
  })

  it('never sends a non-admin to Control, or a client anywhere but their screen', () => {
    expect(switchTarget('/SHARMA26/control', other(), false)).toBe('/PATEL27')
    expect(switchTarget('/SHARMA26/rsvp/queue', other('client'), false)).toBe('/PATEL27/guests')
  })
})
