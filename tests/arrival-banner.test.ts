import { describe, expect, it } from 'vitest'

import {
  ARRIVAL_WINDOW_MINS,
  arrivalBanner,
  bannerText,
  type ArrivalLeg,
} from '@/lib/arrivals/banner'

/**
 * The arrival banner's two sentences.
 *
 * WHY THIS FILE EXISTS. The banner is a number and a minute, and every way it
 * goes wrong is quiet: a family with no scheduled time counted as "arriving"
 * forever, a leg due in two hours announced as next in line, or an arrival
 * from an hour ago still naming a family the coordinator has already greeted.
 */

const NOW = new Date('2026-09-25T14:00:00')

function leg(over: Partial<ArrivalLeg> = {}): ArrivalLeg {
  return {
    legId: 'leg-1',
    groupId: 'grp-1',
    headName: 'Sharma',
    travelDate: '2026-09-25',
    travelTime: '14:30',
    arrivedAt: null,
    roomNumber: null,
    ...over,
  }
}

function iso(minsFromNow: number): string {
  return new Date(NOW.getTime() + minsFromNow * 60_000).toISOString()
}

describe('nothing to say', () => {
  it('returns null for an empty list', () => {
    expect(arrivalBanner([], NOW)).toBeNull()
  })

  it('ignores a leg with no scheduled time', () => {
    // An absent time is not "now"; counting it would be a permanent number.
    expect(arrivalBanner([leg({ travelTime: null })], NOW)).toBeNull()
  })

  it('ignores a leg already in the past that has not arrived', () => {
    expect(arrivalBanner([leg({ travelTime: '13:00' })], NOW)).toBeNull()
  })

  it('ignores a leg more than the window away', () => {
    expect(arrivalBanner([leg({ travelTime: '16:00' })], NOW)).toBeNull()
  })
})

describe('the arriving count', () => {
  it('counts a leg due inside the window', () => {
    const data = arrivalBanner([leg({ travelTime: '14:30' })], NOW)
    expect(data?.arrivingCount).toBe(1)
    expect(data?.windowMins).toBe(ARRIVAL_WINDOW_MINS)
    expect(bannerText(data!)).toBe('1 family arriving in the next 60 min')
  })

  it('counts the window edge, and not the instant now', () => {
    // Exactly +60 is inside; exactly now is not "arriving".
    const at60 = leg({ legId: 'a', travelTime: '15:00' })
    const at0 = leg({ legId: 'b', travelTime: '14:00' })
    const data = arrivalBanner([at60, at0], NOW)
    expect(data?.arrivingCount).toBe(1)
  })

  it('pluralises for several families', () => {
    const data = arrivalBanner(
      [leg({ legId: 'a', travelTime: '14:10' }), leg({ legId: 'b', travelTime: '14:20' })],
      NOW,
    )
    expect(bannerText(data!)).toBe('2 families arriving in the next 60 min')
  })

  it('accepts HH:MM:SS as well as HH:MM', () => {
    const data = arrivalBanner([leg({ travelTime: '14:30:00' })], NOW)
    expect(data?.arrivingCount).toBe(1)
  })
})

describe('the recent arrival', () => {
  it('names the family and the room', () => {
    const data = arrivalBanner(
      [leg({ arrivedAt: iso(-5), roomNumber: '705' })],
      NOW,
    )
    expect(bannerText(data!)).toBe('Sharma family arrived · Room 705')
  })

  it('drops the room clause when there is no room yet', () => {
    const data = arrivalBanner([leg({ arrivedAt: iso(-5), roomNumber: null })], NOW)
    expect(bannerText(data!)).toBe('Sharma family arrived')
  })

  it('stops naming a family after the highlight window', () => {
    const data = arrivalBanner([leg({ arrivedAt: iso(-20) })], NOW)
    expect(data).toBeNull()
  })

  it('wins the banner over an upcoming count', () => {
    const data = arrivalBanner(
      [
        leg({ legId: 'due', travelTime: '14:20' }),
        leg({ legId: 'here', arrivedAt: iso(-3), roomNumber: '705' }),
      ],
      NOW,
    )
    expect(data?.latest?.headName).toBe('Sharma')
    expect(bannerText(data!)).toContain('arrived')
  })

  it('picks the most recent of several arrivals', () => {
    const data = arrivalBanner(
      [
        leg({ legId: 'a', headName: 'Patel', arrivedAt: iso(-12) }),
        leg({ legId: 'b', headName: 'Iyer', arrivedAt: iso(-2) }),
      ],
      NOW,
    )
    expect(data?.latest?.headName).toBe('Iyer')
  })
})
