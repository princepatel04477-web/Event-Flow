import { describe, expect, it } from 'vitest'

import { parentOf, resolveBack, tabOf, type BackState } from '@/lib/nav/back'

const base: BackState = {
  openSheets: 0,
  current: '/SHARMA26',
  previous: null,
  landing: '/SHARMA26',
  lastExitPromptAt: null,
  now: 10_000,
}

describe('resolveBack — UI4 N4', () => {
  it('closes an open sheet before anything else', () => {
    expect(resolveBack({ ...base, openSheets: 1, current: '/SHARMA26/rsvp/queue', previous: '/SHARMA26' })).toEqual({
      type: 'close-sheet',
    })
  })

  it('goes back in history when the previous screen is in the same tab', () => {
    expect(
      resolveBack({ ...base, current: '/SHARMA26/rsvp/status/g1', previous: '/SHARMA26/rsvp/queue' }),
    ).toEqual({ type: 'history-back' })
  })

  it('never walks back through a tab switch', () => {
    // Hospitality, arrived at from Calls: back does NOT return to Calls.
    expect(
      resolveBack({ ...base, current: '/SHARMA26/hospitality/rooms', previous: '/SHARMA26/rsvp/queue' }),
    ).toEqual({ type: 'go', href: '/SHARMA26' })
  })

  it('goes up from a deep-linked detail screen instead of exiting', () => {
    expect(resolveBack({ ...base, current: '/SHARMA26/hospitality/deliveries/d1', previous: null })).toEqual({
      type: 'go',
      href: '/SHARMA26/hospitality/deliveries',
    })
    // A family's record goes up to the call list, not to a status index.
    expect(resolveBack({ ...base, current: '/SHARMA26/rsvp/status/g1' })).toEqual({
      type: 'go',
      href: '/SHARMA26/rsvp/queue',
    })
  })

  it('takes an admin tool back to Control', () => {
    expect(resolveBack({ ...base, current: '/admin/events/SHARMA26/codes', previous: '/SHARMA26/control' })).toEqual({
      type: 'history-back',
    })
    expect(resolveBack({ ...base, current: '/admin/events/SHARMA26/codes', previous: null })).toEqual({
      type: 'go',
      href: '/SHARMA26/control',
    })
  })

  it('asks before closing on the landing tab, then closes on a second press', () => {
    expect(resolveBack({ ...base })).toEqual({ type: 'confirm-exit' })
    expect(resolveBack({ ...base, lastExitPromptAt: 9_000 })).toEqual({ type: 'exit' })
    expect(resolveBack({ ...base, lastExitPromptAt: 5_000 })).toEqual({ type: 'confirm-exit' })
  })

  it("treats a runner's own section as their landing", () => {
    const runner = { ...base, landing: '/SHARMA26/logistics/arrivals' }
    expect(resolveBack({ ...runner, current: '/SHARMA26/logistics/fleet' })).toEqual({ type: 'confirm-exit' })
    expect(resolveBack({ ...runner, current: '/SHARMA26' })).toEqual({
      type: 'go',
      href: '/SHARMA26/logistics/arrivals',
    })
  })
})

describe('tabOf / parentOf', () => {
  it('names the tab a path belongs to', () => {
    expect(tabOf('/SHARMA26')).toBe('')
    expect(tabOf('/SHARMA26/rsvp/queue?show=callback')).toBe('rsvp')
    expect(tabOf('/admin/events/SHARMA26/staff')).toBe('control')
    expect(tabOf('/login')).toBeNull()
  })

  it('has no parent for a tab-level screen', () => {
    expect(parentOf('/SHARMA26/logistics/arrivals')).toBeNull()
    expect(parentOf('/SHARMA26')).toBeNull()
  })
})
