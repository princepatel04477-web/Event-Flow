import { describe, expect, it } from 'vitest'

import {
  arrivalDateChipToValue,
  arrivalTimeChipToValue,
  buildRsvpLogPayload,
  callbackChipToValue,
  extractCallName,
  getArrivalDateChips,
  rsvpLogSchema,
  travelModeChipToValue,
} from '@/lib/rsvp-log'

describe('extractCallName (fix "Call 0" bug)', () => {
  it('strips leading digits, separators, and indexes', () => {
    expect(extractCallName('0 V12-Call Next')).toBe('V12-Call')
    expect(extractCallName('0 Sharma')).toBe('Sharma')
    expect(extractCallName('01. Patel')).toBe('Patel')
    expect(extractCallName('12 - Gupta')).toBe('Gupta')
    expect(extractCallName('0) Verma')).toBe('Verma')
  })

  it('handles Indian wedding names and formats correctly', () => {
    expect(extractCallName('Ramesh Sharma')).toBe('Sharma')
    expect(extractCallName('Sharma, Ramesh')).toBe('Sharma')
    expect(extractCallName('Mr. Ramesh Sharma')).toBe('Sharma')
    expect(extractCallName('Dr. Pooja Patel')).toBe('Patel')
    expect(extractCallName('Sharma Family')).toBe('Sharma')
    expect(extractCallName('Patel Parivar')).toBe('Patel')
  })

  it('handles single names and test names gracefully', () => {
    expect(extractCallName('Pooja')).toBe('Pooja')
    expect(extractCallName('E2E-PROOF-msimzb3g')).toBe('E2E-PROOF-msimzb3g')
  })

  it('handles null, empty, or numbers-only without ever returning "0"', () => {
    expect(extractCallName(null)).toBe('family')
    expect(extractCallName(undefined)).toBe('family')
    expect(extractCallName('')).toBe('family')
    expect(extractCallName('   ')).toBe('family')
    expect(extractCallName('0')).toBe('family')
    expect(extractCallName('123')).toBe('family')
    expect(extractCallName('Unnamed family')).toBe('family')
  })
})

describe('getArrivalDateChips & arrivalDateChipToValue', () => {
  const startsOn = '2026-12-20'

  it('generates correct -2...+1 chips around event start', () => {
    const chips = getArrivalDateChips(startsOn)
    expect(chips).toHaveLength(4)
    expect(chips[0]).toEqual({
      id: 'day_-2',
      label: '18 Dec',
      sublabel: '-2d',
      dateString: '2026-12-18',
    })
    expect(chips[1]).toEqual({
      id: 'day_-1',
      label: '19 Dec',
      sublabel: 'Eve',
      dateString: '2026-12-19',
    })
    expect(chips[2]).toEqual({
      id: 'day_0',
      label: '20 Dec',
      sublabel: 'Start',
      dateString: '2026-12-20',
    })
    expect(chips[3]).toEqual({
      id: 'day_+1',
      label: '21 Dec',
      sublabel: 'Day 2',
      dateString: '2026-12-21',
    })
  })

  it('maps chips to valid date strings', () => {
    expect(arrivalDateChipToValue('day_-2', startsOn)).toBe('2026-12-18')
    expect(arrivalDateChipToValue('day_-1', startsOn)).toBe('2026-12-19')
    expect(arrivalDateChipToValue('day_0', startsOn)).toBe('2026-12-20')
    expect(arrivalDateChipToValue('day_+1', startsOn)).toBe('2026-12-21')
    expect(arrivalDateChipToValue('other', startsOn, '2026-12-15')).toBe('2026-12-15')
  })
})

describe('arrivalTimeChipToValue', () => {
  it('maps time-of-day slots to standard times', () => {
    expect(arrivalTimeChipToValue('morning')).toBe('09:00')
    expect(arrivalTimeChipToValue('afternoon')).toBe('14:00')
    expect(arrivalTimeChipToValue('evening')).toBe('18:00')
    expect(arrivalTimeChipToValue('night')).toBe('21:00')
  })

  it('handles custom exact time', () => {
    expect(arrivalTimeChipToValue('custom', '10:45')).toBe('10:45')
  })
})

describe('travelModeChipToValue', () => {
  it('maps UI travel mode chips to DB travel_mode enum values', () => {
    expect(travelModeChipToValue('train')).toBe('train')
    expect(travelModeChipToValue('flight')).toBe('air')
    expect(travelModeChipToValue('bus')).toBe('bus')
    expect(travelModeChipToValue('road')).toBe('self_drive')
  })
})

describe('callbackChipToValue', () => {
  it('computes "In 1 hour"', () => {
    const base = new Date('2026-09-22T14:12:00')
    const val = callbackChipToValue('1hour', base)
    // 1 hour later: 15:10 rounded
    expect(val).toMatch(/^2026-09-22T15:/)
  })

  it('computes "This evening"', () => {
    const afternoon = new Date('2026-09-22T14:00:00')
    expect(callbackChipToValue('evening', afternoon)).toBe('2026-09-22T18:00')

    const lateNight = new Date('2026-09-22T21:00:00')
    expect(callbackChipToValue('evening', lateNight)).toBe('2026-09-23T18:00')
  })

  it('computes "Tomorrow morning"', () => {
    const base = new Date('2026-09-22T14:00:00')
    expect(callbackChipToValue('tomorrow_morning', base)).toBe('2026-09-23T10:00')
  })

  it('passes through custom time', () => {
    expect(callbackChipToValue('custom', new Date(), '2026-09-25T11:00')).toBe('2026-09-25T11:00')
  })
})

describe('buildRsvpLogPayload & schema validation', () => {
  it('builds a valid payload for a full Coming response', () => {
    const payload = buildRsvpLogPayload({
      rsvpStatus: 'confirmed',
      adultsCount: 4,
      childrenCount: 2,
      arrivalDate: '2026-12-19',
      arrivalTime: '09:00',
      travelMode: 'train',
      flightTrainNo: '12951',
      needsPickup: true,
      departureDate: '2026-12-24',
      departureTime: '18:00',
      departureMode: 'self_drive',
      notes: 'Vegetarian meals',
    })

    const result = rsvpLogSchema.safeParse(payload)
    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data.rsvpStatus).toBe('confirmed')
    expect(result.data.adultsConfirmed).toBe('4')
    expect(result.data.childrenConfirmed).toBe('2')
    expect(result.data.arrival.mode).toBe('train')
    expect(result.data.arrival.date).toBe('2026-12-19')
    expect(result.data.arrival.time).toBe('09:00')
    expect(result.data.arrival.flightTrainNo).toBe('12951')
    expect(result.data.needsPickup).toBe(true)
    expect(result.data.departure.date).toBe('2026-12-24')
    expect(result.data.notes).toBe('Vegetarian meals')
  })

  it('builds a valid payload for Callback', () => {
    const payload = buildRsvpLogPayload({
      rsvpStatus: 'callback',
      adultsCount: 0,
      childrenCount: 0,
      arrivalDate: '',
      arrivalTime: '',
      travelMode: '',
      needsPickup: false,
      callbackDatetime: '2026-12-21T10:00',
    })

    const result = rsvpLogSchema.safeParse(payload)
    expect(result.success).toBe(true)
  })
})
