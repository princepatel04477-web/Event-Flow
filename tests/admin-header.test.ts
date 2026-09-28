import { describe, expect, it } from 'vitest'

import { adminHeaderFor } from '@/lib/admin/header'

/**
 * UI4 Part S: an admin tool on a phone is one of Control's screens. Its back
 * link goes to the event's Control tab, never to a separate "App".
 */
describe('adminHeaderFor', () => {
  it('sends a top-level tool back to the event Control tab', () => {
    expect(adminHeaderFor('/admin/events/SHARMA26/codes')).toEqual({
      title: 'Access codes',
      backHref: '/SHARMA26/control',
      backLabel: 'Control',
    })
    expect(adminHeaderFor('/admin/events/SHARMA26/staff').title).toBe('Staff')
  })

  it('sends a nested screen back to its tool, not to Control', () => {
    expect(adminHeaderFor('/admin/events/SHARMA26/hotels/abc/rooms')).toEqual({
      title: 'Hotels',
      backHref: '/admin/events/SHARMA26/hotels',
      backLabel: 'Hotels',
    })
  })

  it('names the events list and the developer tools', () => {
    expect(adminHeaderFor('/admin/events').title).toBe('All events')
    expect(adminHeaderFor('/admin/harvest-debug').title).toBe('Developer tools')
  })

  it('never labels a back link "App"', () => {
    for (const p of ['/admin', '/admin/events', '/admin/events/X', '/admin/events/X/files', '/admin/harvest-debug']) {
      expect(adminHeaderFor(p).backLabel).not.toBe('App')
    }
  })
})
