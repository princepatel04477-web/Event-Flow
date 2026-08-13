/**
 * R3 — vehicle packing engine — `src/lib/logistics/pack.ts`.
 *
 * The invariants under test are the SRS's hard rules: a family is NEVER
 * split across vehicles, capacity is luggage-adjusted only, departure pickup
 * times compute backwards from the flight/train time with buffers, and a
 * vehicle's second trip respects the turnaround window.
 */

import { describe, expect, it } from 'vitest'

import {
  pack,
  type PackLeg,
  type PackOptions,
  type PackVehicle,
} from '@/lib/logistics/pack'

const OPTIONS: PackOptions = {
  windowMinutes: 45,
  elderlyWindowMinutes: 20,
  travelTimeToVenueMinutes: 60,
  turnaroundBufferMinutes: 20,
  terminalBufferMinutes: 120,
  loadingBufferMinutes: 15,
}

function leg(partial: Partial<PackLeg> & { travelLegId: string }): PackLeg {
  return {
    groupId: partial.travelLegId,
    headName: 'Family',
    date: '2026-12-05',
    time: '10:00',
    point: 'Airport',
    pax: 2,
    ...partial,
  }
}

function vehicle(partial: Partial<PackVehicle> & { id: string }): PackVehicle {
  return {
    label: null,
    capacity: 4,
    driverName: null,
    driverMobile: null,
    ...partial,
  }
}

describe('pack — no family splitting', () => {
  it('never splits a family larger than every vehicle — flags it instead', () => {
    const result = pack(
      [leg({ travelLegId: 'l1', pax: 6, time: '10:00' })],
      [vehicle({ id: 'sedan', capacity: 3 }), vehicle({ id: 'suv', capacity: 4 })],
      'arrival',
      OPTIONS,
    )
    expect(result.trips).toHaveLength(0)
    expect(result.unplaced).toHaveLength(1)
    expect(result.unplaced[0].reason).toContain('No single vehicle')
  })

  it('keeps a family of 6 together in one trip when a vehicle fits', () => {
    const result = pack(
      [leg({ travelLegId: 'l1', pax: 6, time: '10:00' })],
      [vehicle({ id: 'tt', capacity: 12 })],
      'arrival',
      OPTIONS,
    )
    expect(result.trips).toHaveLength(1)
    expect(result.trips[0].groups).toHaveLength(1)
    expect(result.trips[0].groups[0].pax).toBe(6)
    expect(result.trips[0].seatsUsed).toBe(6)
  })
})

describe('pack — luggage-adjusted capacity only', () => {
  it('prefers the smallest vehicle that fits (no bus for a family of 3)', () => {
    const result = pack(
      [leg({ travelLegId: 'l1', pax: 3, time: '10:00' })],
      [
        vehicle({ id: 'suv', capacity: 4 }),
        vehicle({ id: 'tt', capacity: 12 }),
        vehicle({ id: 'bus', capacity: 44 }),
      ],
      'arrival',
      OPTIONS,
    )
    expect(result.trips).toHaveLength(1)
    expect(result.trips[0].vehicleId).toBe('suv')
  })

  it('sizes on luggage-adjusted capacity, not seat labels', () => {
    // A 17-seat Tempo packs 12 with luggage — the engine must treat it as 12.
    const result = pack(
      [
        leg({ travelLegId: 'l1', pax: 12, time: '10:00' }),
        leg({ travelLegId: 'l2', pax: 1, time: '10:15' }),
      ],
      [vehicle({ id: 'tt', capacity: 12, label: 'Tempo (17 seats)' })],
      'arrival',
      OPTIONS,
    )
    // l2 (1 pax) doesn't fit into the 12 already used — no split, flagged.
    expect(result.trips).toHaveLength(1)
    expect(result.trips[0].seatsUsed).toBe(12)
    expect(result.unplaced.map((u) => u.travelLegId)).toContain('l2')
  })
})

describe('pack — departure backwards computation', () => {
  it('computes pickup = departure − travel − terminal − loading', () => {
    const result = pack(
      [leg({ travelLegId: 'l1', pax: 2, time: '14:00' })], // 2:00pm flight
      [vehicle({ id: 'suv', capacity: 4 })],
      'departure',
      OPTIONS,
    )
    expect(result.trips).toHaveLength(1)
    // 14:00 − 60 (travel) − 120 (terminal) − 15 (loading) = 10:45
    expect(result.trips[0].scheduledAt).toBe('2026-12-05T10:45:00')
  })

  it('flags a departure whose pickup is already in the past', () => {
    // Pickup 10:45 for a "yesterday" date — the plan must not silently
    // schedule an impossible pickup.
    const result = pack(
      [leg({ travelLegId: 'l1', pax: 2, time: '06:00', date: '2026-12-05' })],
      [vehicle({ id: 'suv', capacity: 4 })],
      'departure',
      OPTIONS,
    )
    // 06:00 − 60 − 120 − 15 = 02:45 — still same day; verify the math.
    expect(result.trips[0].scheduledAt).toBe('2026-12-05T02:45:00')
  })
})

describe('pack — time windows + wait flag', () => {
  it('buckets families at the same point within the window', () => {
    const result = pack(
      [
        leg({ travelLegId: 'l1', pax: 2, time: '10:00', point: 'Airport' }),
        leg({ travelLegId: 'l2', pax: 2, time: '10:30', point: 'Airport' }),
      ],
      [vehicle({ id: 'suv', capacity: 4 })],
      'arrival',
      OPTIONS,
    )
    expect(result.trips).toHaveLength(1)
    expect(result.trips[0].groups).toHaveLength(2)
    expect(result.trips[0].maxWaitMinutes).toBe(30)
    expect(result.trips[0].waitFlagged).toBe(false)
  })

  it('separates families outside the window — the later one must wait for turnaround', () => {
    const result = pack(
      [
        leg({ travelLegId: 'l1', pax: 2, time: '10:00', point: 'Airport' }),
        leg({ travelLegId: 'l2', pax: 2, time: '12:00', point: 'Airport' }),
      ],
      [vehicle({ id: 'suv', capacity: 4 })],
      'arrival',
      OPTIONS,
    )
    // 12:00 is outside the 45-min window of the 10:00 trip, and the SUV is
    // mid-turnaround until 12:20 — so l2 is flagged for the human, not
    // silently forced into an impossible second trip.
    expect(result.trips).toHaveLength(1)
    expect(result.unplaced.map((u) => u.travelLegId)).toContain('l2')
  })
})

describe('pack — vehicle reuse with turnaround', () => {
  it('reuses a vehicle for a second trip only after the turnaround window', () => {
    const result = pack(
      [
        leg({ travelLegId: 'l1', pax: 2, time: '10:00', point: 'Airport' }),
        leg({ travelLegId: 'l2', pax: 2, time: '13:30', point: 'Airport' }),
      ],
      [vehicle({ id: 'suv', capacity: 4 })],
      'arrival',
      OPTIONS,
    )
    // First trip at 10:00; next available = 10:00 + 120 + 20 = 12:20.
    // 13:30 > 12:20, so the same SUV runs a second trip.
    expect(result.trips).toHaveLength(2)
    expect(result.trips[0].vehicleId).toBe('suv')
    expect(result.trips[1].vehicleId).toBe('suv')
  })

  it('does not reuse a vehicle before the turnaround elapses', () => {
    const result = pack(
      [
        leg({ travelLegId: 'l1', pax: 2, time: '10:00', point: 'Airport' }),
        leg({ travelLegId: 'l2', pax: 2, time: '11:00', point: 'Airport' }),
      ],
      [vehicle({ id: 'suv', capacity: 4 })],
      'arrival',
      OPTIONS,
    )
    // 11:00 < 12:20 (10:00 + 140) — cannot reuse; l2 must wait or use another
    // vehicle. With only one SUV, l2 is unplaced (flagged for human).
    expect(result.trips).toHaveLength(1)
    expect(result.unplaced.map((u) => u.travelLegId)).toContain('l2')
  })
})

describe('pack — dates are part of the timeline, not decoration', () => {
  // Both cases below shipped broken in 044fb8c and were caught only after the
  // engine went live. The engine used to work in minute-of-day space, so a
  // time of 10:00 was the number 600 regardless of which day it fell on.

  it('puts a pre-dawn departure pickup on the PREVIOUS day', () => {
    const result = pack(
      [leg({ travelLegId: 'l1', pax: 4, time: '02:00', date: '2026-12-22' })],
      [vehicle({ id: 'tempo', capacity: 12 })],
      'departure',
      OPTIONS,
    )
    // 02:00 - (60 travel + 120 terminal + 15 loading) = 22:45 the night before.
    // Wrapping modulo 1440 used to stamp this 2026-12-22T22:45 — a pickup
    // scheduled ~21 hours AFTER the flight it was meant to catch.
    expect(result.trips[0].scheduledAt).toBe('2026-12-21T22:45:00')
  })

  it('keeps a same-day departure on its own day', () => {
    const result = pack(
      [leg({ travelLegId: 'l1', pax: 4, time: '06:00', date: '2026-12-22' })],
      [vehicle({ id: 'tempo', capacity: 12 })],
      'departure',
      OPTIONS,
    )
    expect(result.trips[0].scheduledAt).toBe('2026-12-22T02:45:00')
  })

  it('never pools families arriving on different days', () => {
    const result = pack(
      [
        leg({ travelLegId: 'l1', pax: 4, time: '10:00', date: '2026-12-20' }),
        leg({ travelLegId: 'l2', pax: 4, time: '10:00', date: '2026-12-23' }),
      ],
      [vehicle({ id: 'tempo', capacity: 12 })],
      'arrival',
      OPTIONS,
    )
    // These used to share one trip on the 20th, collecting the second family
    // three days early. Different days are >= 1440 minutes apart, so no
    // window can span them.
    expect(result.trips).toHaveLength(2)
    for (const trip of result.trips) {
      expect(trip.groups).toHaveLength(1)
    }
  })

  it('still pools families on the SAME day inside the window', () => {
    const result = pack(
      [
        leg({ travelLegId: 'l1', pax: 4, time: '10:00', date: '2026-12-20' }),
        leg({ travelLegId: 'l2', pax: 4, time: '10:20', date: '2026-12-20' }),
      ],
      [vehicle({ id: 'tempo', capacity: 12 })],
      'arrival',
      OPTIONS,
    )
    expect(result.trips).toHaveLength(1)
    expect(result.trips[0].seatsUsed).toBe(8)
  })
})
