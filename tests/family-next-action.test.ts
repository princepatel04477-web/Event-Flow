import { describe, expect, it } from 'vitest'

import { familyNextAction, type FamilyAbilities, type FamilyFacts } from '@/lib/family/next-action'

const facts = (over: Partial<FamilyFacts> = {}): FamilyFacts => ({
  rsvpStatus: 'not_started',
  callbackAt: null,
  arrivingToday: false,
  checkedIn: false,
  hamperStatus: null,
  ...over,
})
const all: FamilyAbilities = { canCall: true, canCheckIn: true, canDeliver: true }

describe('familyNextAction — the S4 table', () => {
  it('calls a family nobody has reached', () => {
    expect(familyNextAction(facts(), all)).toBe('call')
    expect(familyNextAction(facts({ rsvpStatus: 'unreachable' }), all)).toBe('call')
  })

  it('calls back a family that asked for it', () => {
    expect(familyNextAction(facts({ rsvpStatus: 'callback', callbackAt: '2026-12-18T18:00:00Z' }), all)).toBe('call-back')
  })

  it('checks in a coming family landing today', () => {
    expect(familyNextAction(facts({ rsvpStatus: 'confirmed', arrivingToday: true }), all)).toBe('check-in')
  })

  it('delivers the hamper once they are checked in', () => {
    expect(
      familyNextAction(facts({ rsvpStatus: 'confirmed', checkedIn: true, hamperStatus: 'pending' }), all),
    ).toBe('deliver-hamper')
  })

  it('offers nothing when everything is done, or they are not coming', () => {
    expect(
      familyNextAction(facts({ rsvpStatus: 'confirmed', checkedIn: true, hamperStatus: 'delivered' }), all),
    ).toBeNull()
    expect(familyNextAction(facts({ rsvpStatus: 'declined' }), all)).toBeNull()
  })

  it("never offers an action the viewer's department cannot take", () => {
    const hospitality: FamilyAbilities = { canCall: false, canCheckIn: true, canDeliver: true }
    expect(familyNextAction(facts(), hospitality)).toBeNull()
    expect(familyNextAction(facts({ rsvpStatus: 'confirmed', arrivingToday: true }), { ...all, canCheckIn: false })).toBeNull()
  })
})
