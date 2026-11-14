import { describe, expect, it } from 'vitest'

import {
  buildRsvpLogPayload,
  rsvpLogSchema,
} from '@/lib/rsvp-log'
import { paxCount, type TravelRow } from '@/app/(app)/v2/[eventCode]/logistics/_components/_travel'

describe('Split arrival feature', () => {
  it('builds and validates a split arrival payload (e.g. 4 by train, 2 by road)', () => {
    const payload = buildRsvpLogPayload({
      rsvpStatus: 'confirmed',
      adultsCount: 4,
      childrenCount: 2,
      arrivalDate: '2026-12-20',
      arrivalTime: '10:30',
      travelMode: 'train',
      flightTrainNo: '12951 Rajdhani',
      arrivalPaxOnLeg: 4,
      needsPickup: true,
      splitArrival: {
        mode: 'self_drive',
        date: '2026-12-20',
        time: '11:00',
        location: '',
        flightTrainNo: '',
        paxOnLeg: 2,
      },
    })

    expect(payload.rsvpStatus).toBe('confirmed')
    expect(payload.adultsConfirmed).toBe('4')
    expect(payload.childrenConfirmed).toBe('2')
    expect(payload.arrival.mode).toBe('train')
    expect(payload.arrival.paxOnLeg).toBe(4)
    expect(payload.arrival.flightTrainNo).toBe('12951 Rajdhani')

    expect(payload.splitArrival).toBeDefined()
    expect(payload.splitArrival?.mode).toBe('self_drive')
    expect(payload.splitArrival?.paxOnLeg).toBe(2)

    // Zod schema validation
    const parsed = rsvpLogSchema.safeParse(payload)
    expect(parsed.success).toBe(true)
  })

  it('correctly calculates split paxCount on individual travel rows', () => {
    const baseGroup = {
      id: 'grp-1',
      head_name: 'Sharma Family',
      primary_mobile: '+919876543210',
      expected_pax: 6,
      adults_confirmed: 4,
      children_confirmed: 2,
      needs_pickup: true,
    }

    const trainRow: TravelRow = {
      group: baseGroup,
      roomLabel: '101',
      leg: {
        id: 'leg-train',
        group_id: 'grp-1',
        mode: 'train',
        travel_date: '2026-12-20',
        travel_time: '10:30:00',
        reference: '12951',
        point: 'Surat Station',
        pax_on_leg: 4,
        arrived_at: null,
        departed_at: null,
      },
    }

    const roadRow: TravelRow = {
      group: baseGroup,
      roomLabel: '101',
      leg: {
        id: 'leg-road',
        group_id: 'grp-1',
        mode: 'self_drive',
        travel_date: '2026-12-20',
        travel_time: '11:00:00',
        reference: null,
        point: 'By road',
        pax_on_leg: 2,
        arrived_at: null,
        departed_at: null,
      },
    }

    // Both rows must report their distinct leg passenger counts, not the group total
    expect(paxCount(trainRow)).toBe(4)
    expect(paxCount(roadRow)).toBe(2)
  })
})
