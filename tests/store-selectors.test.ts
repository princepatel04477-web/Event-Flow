import { describe, expect, it } from 'vitest'

import { applyOps } from '@/lib/store/reducer'
import {
  activeAssignmentIds,
  headcount,
  legIdsFor,
  optimisticAddGuestOps,
  optimisticPlaceOps,
  optimisticRemoveOps,
  roomLabelFor,
  selectCheckInRows,
  selectClientRows,
  selectDeliveryRun,
  selectFamily,
  selectFindResults,
  selectQueueRows,
  selectRoomsGrid,
  selectStaffLookup,
  selectStaffNames,
  selectTodayNumbers,
  selectTravelRows,
  unplacedGuestIds,
} from '@/lib/store/selectors'
import { parseSnapshot, stateFromSnapshot } from '@/lib/store/snapshot'
import type { EventState } from '@/lib/store/types'

import {
  EVENT_ID,
  assignment,
  at,
  group,
  guest,
  rawSnapshot,
  stateFrom,
  twoFamilySnapshot,
} from './helpers/store-fixture'

/**
 * The screen projections: each one is a server read rebuilt in JS.
 *
 * The assertions are written against the SQL each projection copies — "the view
 * says this", not "the function currently returns this" — because the failure
 * that matters is not a crash. It is the Rooms header saying 41 beds free when
 * a blocked room is counted, or Find matching a phone number for a client.
 */

function state(over: Parameters<typeof rawSnapshot>[0] = {}): EventState {
  const base = twoFamilySnapshot()
  const parsed = parseSnapshot(rawSnapshot({ ...base, ...over }))
  if (!parsed) throw new Error('fixture did not parse')
  return stateFromSnapshot(EVENT_ID, parsed.data, parsed.dropped)
}

describe('selectQueueRows — v_rsvp_queue', () => {
  it('reduces the call aggregate onto the group', () => {
    const rows = selectQueueRows(state())
    const sharma = rows.find((row) => row.group_id === 'g-sharma')
    expect(sharma?.attempt_count).toBe(2)
    expect(sharma?.last_outcome).toBe('connected')
    expect(sharma?.head_name).toBe('Sharma')
    expect(sharma?.rsvp_status).toBe('confirmed')
  })

  it('gives a never-dialled family a zero count, not a missing one', () => {
    const desai = selectQueueRows(state()).find((row) => row.group_id === 'g-desai')
    expect(desai?.attempt_count).toBe(0)
    expect(desai?.last_outcome).toBeNull()
  })

  it('orders by fewest attempts, then least recently dialled', () => {
    const rows = selectQueueRows(state())
    // Desai has never been called, so it is first — the queue's whole purpose.
    expect(rows[0]?.group_id).toBe('g-desai')
    expect(rows[1]?.group_id).toBe('g-sharma')
  })

  it('judges the lock against the phone clock', () => {
    const fut = new Date(Date.now() + 10 * 60_000).toISOString()
    const past = new Date(Date.now() - 10 * 60_000).toISOString()

    const held = selectQueueRows(
      state({ groups: [group({ id: 'g-sharma', locked_until: fut, locked_by_staff: 's-1' })] }),
    ).find((row) => row.group_id === 'g-sharma')
    expect(held?.is_locked).toBe(true)
    expect(held?.locked_by_staff).toBe('s-1')

    const expired = selectQueueRows(
      state({ groups: [group({ id: 'g-sharma', locked_until: past })] }),
    ).find((row) => row.group_id === 'g-sharma')
    // A lock that has run out must not keep reading as held: the runner would
    // walk away from a family that is free.
    expect(expired?.is_locked).toBe(false)
  })
})

describe('selectFamily', () => {
  it('returns the fields the capture step reads', () => {
    const family = selectFamily(state(), 'g-sharma')
    expect(family?.head_name).toBe('Sharma')
    expect(family?.confirmed_pax).toBe(6)
    expect(family?.special_requirements).toEqual([])
  })

  it('returns null for a group that is not in the store', () => {
    expect(selectFamily(state(), 'g-nope')).toBeNull()
    expect(selectFamily(state(), null)).toBeNull()
  })
})

describe('selectStaffLookup', () => {
  it('resolves an id to a name and an unknown id to null', () => {
    const lookup = selectStaffLookup(state())
    expect(lookup.nameOf('s-1')).toBe('Ravi Patel')
    expect(lookup.nameOf('s-nope')).toBeNull()
    expect(lookup.nameOf(null)).toBeNull()
  })

  it('agrees with the plain map', () => {
    const names = selectStaffNames(state())
    expect(names['s-1']).toBe('Ravi Patel')
  })
})

describe('selectRoomsGrid — readRoomsGrid', () => {
  it('counts occupancy, free beds and the totals line', () => {
    const grid = selectRoomsGrid(state())
    const room = grid.rooms[0]
    expect(room?.roomNumber).toBe('A101')
    expect(room?.occupants).toHaveLength(1)
    expect(room?.freeBeds).toBe(1)
    expect(room?.isOverCapacity).toBe(false)
    expect(grid.totals.confirmedGuests).toBe(6)
    expect(grid.totals.guestsWithBed).toBe(1)
    expect(grid.totals.bedsFree).toBe(1)
  })

  it('excludes a blocked room from the free-bed count', () => {
    const grid = selectRoomsGrid(state({ rooms: undefined }))
    void grid
    const blocked = selectRoomsGrid(
      state({
        rooms: [
          {
            id: 'r-1',
            hotel_id: 'h-1',
            room_number: 'A101',
            capacity: 2,
            max_capacity: 3,
            floor: '1',
            room_type: null,
            is_blocked: true,
            notes: null,
            created_at: at(),
            updated_at: at(),
          },
        ],
      }),
    )
    expect(blocked.totals.bedsFree).toBe(0)
  })

  it('lists confirmed guests with no bed as unplaced', () => {
    const grid = selectRoomsGrid(state())
    // gu-2 is a confirmed Sharma with no assignment; gu-1 has one.
    expect(grid.unplaced.map((row) => row.guestId)).toEqual(['gu-2'])
  })

  it('reports a family below its headcount as under-bedded', () => {
    const grid = selectRoomsGrid(state())
    const sharma = grid.underBedded.find((row) => row.groupId === 'g-sharma')
    expect(sharma?.headcount).toBe(6)
    expect(sharma?.placed).toBe(1)
    expect(sharma?.shortfall).toBe(5)
    // Two guest rows for a family of six: the names have not all been collected.
    expect(sharma?.needsTopUp).toBe(true)
    expect(grid.totals.familiesWaiting).toBe(1)
  })

  it('leaves a declined family out of the bed arithmetic entirely', () => {
    const grid = selectRoomsGrid(state({ groups: [group({ id: 'g-sharma', rsvp_status: 'declined' })] }))
    expect(grid.totals.confirmedGuests).toBe(0)
    expect(grid.totals.guestsWithBed).toBe(0)
    expect(grid.underBedded).toHaveLength(0)
  })

  it('names a family head by the group name, matching the server read', () => {
    const grid = selectRoomsGrid(state())
    const occupant = grid.rooms[0]?.occupants[0]
    // `readRoomsGrid` uses `head_name` for a head, not `guests.full_name`.
    expect(occupant?.guestName).toBe('Sharma')
    expect(occupant?.isHead).toBe(true)
  })

  it('drops a room out of the grid when a full snapshot no longer has it', () => {
    const before = selectRoomsGrid(state())
    expect(before.rooms).toHaveLength(1)
    const after = selectRoomsGrid(state({ rooms: [], assignments: [] }))
    expect(after.rooms).toHaveLength(0)
    expect(after.totals.bedsFree).toBe(0)
  })
})

describe('selectCheckInRows — the check-in board', () => {
  it('joins the room label and counts pending deliverables', () => {
    const rows = selectCheckInRows(state())
    expect(rows).toHaveLength(1)
    expect(rows[0]?.roomLabel).toBe('Grand Bhagwati A101')
    // d-1 (Sharma) is delivered, so nothing is pending for this family.
    expect(rows[0]?.pendingDeliverables).toEqual([])
    expect(rows[0]?.group.head_name).toBe('Sharma')
  })

  it('flags the family with a hamper still owed', () => {
    const rows = selectCheckInRows(
      state({
        assignments: [
          assignment({ id: 'a-2', room_id: 'r-1', guest_id: 'gu-3', group_id: 'g-desai' }),
        ],
      }),
    )
    expect(rows[0]?.pendingDeliverables).toEqual(['Hamper'])
  })

  it('names whoever else is already checked into the room', () => {
    const rows = selectCheckInRows(
      state({
        assignments: [
          assignment({
            id: 'a-1',
            room_id: 'r-1',
            guest_id: 'gu-1',
            group_id: 'g-sharma',
            checked_in_at: at(5),
          }),
          assignment({ id: 'a-2', room_id: 'r-1', guest_id: 'gu-3', group_id: 'g-desai' }),
        ],
      }),
    )
    const desai = rows.find((row) => row.group.id === 'g-desai')
    // The blocking banner names the family already in the room, which is what
    // stops a double check-in at the desk.
    expect(desai?.occupiedByOther).toBe('Sharma')
  })

  it('does not flag a checked-out occupant', () => {
    const rows = selectCheckInRows(
      state({
        assignments: [
          assignment({
            id: 'a-1',
            room_id: 'r-1',
            guest_id: 'gu-1',
            group_id: 'g-sharma',
            checked_in_at: at(5),
            checked_out_at: at(90),
          }),
          assignment({ id: 'a-2', room_id: 'r-1', guest_id: 'gu-3', group_id: 'g-desai' }),
        ],
      }),
    )
    const desai = rows.find((row) => row.group.id === 'g-desai')
    expect(desai?.occupiedByOther).toBeNull()
  })

  it('drops an assignment whose family is not in the store', () => {
    const rows = selectCheckInRows(
      state({
        assignments: [
          assignment({ id: 'a-orphan', room_id: 'r-1', guest_id: 'gu-1', group_id: 'g-gone' }),
        ],
      }),
    )
    expect(rows).toHaveLength(0)
  })

  it('puts event_id back on the embedded rows the screen types expect', () => {
    const row = selectCheckInRows(state())[0]
    expect(row?.assignment.event_id).toBe(EVENT_ID)
    expect(row?.group.event_id).toBe(EVENT_ID)
  })
})

describe('selectDeliveryRun — the hamper run', () => {
  it('flattens the family and room onto each deliverable', () => {
    const rows = selectDeliveryRun(state())
    const sharma = rows.find((row) => row.id === 'd-1')
    expect(sharma?.head_name).toBe('Sharma')
    expect(sharma?.hotel_name).toBe('Grand Bhagwati')
    expect(sharma?.room_number).toBe('A101')
    // `deliverables.room_id` is null in the fixture, so the room comes from the
    // family's live assignment — the room the family is actually in.
    expect(sharma?.status).toBe('delivered')
    expect(sharma?.kind).toBe('hamper')
  })

  it('leaves a family that has no room yet without a hotel', () => {
    const desai = selectDeliveryRun(state()).find((row) => row.id === 'd-2')
    expect(desai?.room_number).toBeNull()
    expect(desai?.hotel_name).toBeNull()
    expect(desai?.head_name).toBe('Desai')
  })
})

describe('selectTravelRows — the travel board', () => {
  it('keeps only the requested direction', () => {
    const arrivals = selectTravelRows(state(), 'arrival')
    const departures = selectTravelRows(state(), 'departure')
    expect(arrivals.map((row) => row.leg.id)).toEqual(['leg-1'])
    expect(departures.map((row) => row.leg.id)).toEqual(['leg-2'])
  })

  it('joins the room label the way the old queryFn did', () => {
    expect(selectTravelRows(state(), 'arrival')[0]?.roomLabel).toBe('Grand Bhagwati A101')
  })

  it('drops a leg whose family is not in the store', () => {
    const rows = selectTravelRows(
      state({
        legs: [
          {
            id: 'leg-orphan',
            group_id: 'g-gone',
            direction: 'arrival',
            mode: 'air',
            travel_date: '2026-12-20',
            travel_time: '09:00:00',
            reference: null,
            point: null,
            pax_on_leg: 2,
            needs_transport: true,
            source: 'rsvp_call',
            notes: null,
            created_by: null,
            created_by_staff: null,
            created_at: at(),
            updated_at: at(),
            arrived_at: null,
            departed_at: null,
          },
        ],
      }),
      'arrival',
    )
    expect(rows).toHaveLength(0)
  })

  it('sorts a dated leg before an undated one', () => {
    const rows = selectTravelRows(
      state({
        legs: [
          {
            id: 'leg-nodate',
            group_id: 'g-sharma',
            direction: 'arrival',
            mode: 'cab',
            travel_date: null,
            travel_time: null,
            reference: null,
            point: null,
            pax_on_leg: 1,
            needs_transport: true,
            source: 'rsvp_call',
            notes: null,
            created_by: null,
            created_by_staff: null,
            created_at: at(),
            updated_at: at(),
            arrived_at: null,
            departed_at: null,
          },
          {
            id: 'leg-dated',
            group_id: 'g-desai',
            direction: 'arrival',
            mode: 'air',
            travel_date: '2026-12-20',
            travel_time: '10:30:00',
            reference: null,
            point: null,
            pax_on_leg: 3,
            needs_transport: true,
            source: 'rsvp_call',
            notes: null,
            created_by: null,
            created_by_staff: null,
            created_at: at(),
            updated_at: at(),
            arrived_at: null,
            departed_at: null,
          },
        ],
      }),
      'arrival',
    )
    // The undated leg is the one still to be completed, not the one at the top.
    expect(rows.map((row) => row.leg.id)).toEqual(['leg-dated', 'leg-nodate'])
  })
})

describe('selectFindResults — local search', () => {
  it('answers nothing for a term under two characters', () => {
    expect(selectFindResults(state(), 's')).toEqual([])
    expect(selectFindResults(state(), '  ')).toEqual([])
  })

  it('matches a guest name, a family head and a room number', () => {
    expect(selectFindResults(state(), 'ramesh').map((r) => r.profile.guest_id)).toEqual(['gu-1'])
    expect(selectFindResults(state(), 'desai').map((r) => r.profile.guest_id)).toEqual(['gu-3'])
    expect(selectFindResults(state(), 'a101').map((r) => r.profile.guest_id)).toEqual([
      'gu-1',
      'gu-2',
    ])
  })

  it('carries the group id so a result can open the family', () => {
    const [first] = selectFindResults(state(), 'ramesh')
    expect(first?.groupId).toBe('g-sharma')
  })

  it('matches a mobile number, with rsvp_status nulled as the RPC leg did', () => {
    // gu-2 is not in `client` under a phone match that the view already covered,
    // so search Sita's own mobile — which the view does not carry.
    const found = selectFindResults(state(), '9825011111')
    expect(found.map((r) => r.profile.guest_id).sort()).toEqual(['gu-1', 'gu-2'])
    // Neither row was found by the VIEW leg (a view row carries no phone), so
    // BOTH come from the phone leg and both render without a status pill -
    // exactly what sProfileRow did to the RPC's rows.
    for (const result of found) expect(result.profile.rsvp_status).toBeNull()
  })

  it('never searches a phone number for a client session', () => {
    const clientState = stateFrom(rawSnapshot({ ...twoFamilySnapshot(), role: 'client' }))
    const found = selectFindResults(clientState, '9825011111')
    expect(found).toEqual([])
  })

  it('caps the result set at one screen of rows', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      event_id: EVENT_ID,
      guest_id: `gu-${i}`,
      guest_name: `Match ${i}`,
      family_head: 'Match',
      group_type: 'family' as const,
      side: null,
      pax: 1,
      rsvp_status: null,
      hotel_name: null,
      room_number: null,
      arrival_date: null,
      arrival_time: null,
      arrival_mode: null,
      arrival_point: null,
      departure_date: null,
      departure_time: null,
      departure_mode: null,
      departure_point: null,
      hamper_delivered: null,
      return_gift_delivered: null,
      needs_return_gift: null,
    }))
    expect(selectFindResults(state({ client: many, guests: [] }), 'match')).toHaveLength(50)
  })
})

describe('selectTodayNumbers — v_event_board', () => {
  const TODAY = '2026-12-20'

  it('counts the board the way the view does', () => {
    const numbers = selectTodayNumbers(state(), TODAY)
    expect(numbers.totalGroups).toBe(2)
    // confirmed_pax 6 + expected_pax 3.
    expect(numbers.totalPax).toBe(9)
    expect(numbers.rsvpConfirmed).toBe(1)
    expect(numbers.rsvpPending).toBe(1)
    expect(numbers.guestsRoomed).toBe(1)
    expect(numbers.hampersDelivered).toBe(1)
    expect(numbers.hampersPending).toBe(1)
    expect(numbers.arrivalsToday).toBe(1)
    expect(numbers.departuresToday).toBe(0)
  })

  it('counts a confirmed family with no bed and no departure leg', () => {
    const numbers = selectTodayNumbers(state(), TODAY)
    // Sharma has a room AND a departure leg in the fixture; Desai is not
    // confirmed, so neither attention count fires.
    expect(numbers.confirmedNoRoom).toBe(0)
    expect(numbers.noDeparture).toBe(0)
  })

  it('flags a confirmed family with no departure leg at all', () => {
    expect(selectTodayNumbers(state({ legs: [] }), TODAY).noDeparture).toBe(1)
  })

  it('finds the confirmed family that has no room', () => {
    const numbers = selectTodayNumbers(state({ assignments: [] }), TODAY)
    expect(numbers.confirmedNoRoom).toBe(1)
    expect(numbers.guestsRoomed).toBe(0)
  })

  it('counts an arrival with no vehicle', () => {
    expect(selectTodayNumbers(state(), TODAY).arrivalsNoVehicle).toBe(0)
    const noTrip = selectTodayNumbers(state({ tripPassengers: [] }), TODAY)
    expect(noTrip.arrivalsNoVehicle).toBe(1)
  })

  it('puts a leg on a different day out of today', () => {
    const numbers = selectTodayNumbers(state(), '2026-12-21')
    expect(numbers.arrivalsToday).toBe(0)
    expect(numbers.departuresToday).toBe(0)
    // ...but the departure anti-join is not date-scoped, so a family with a
    // departure leg on ANY day is covered.
    expect(numbers.noDeparture).toBe(0)
  })
})

describe('headcount', () => {
  it('prefers a confirmed count over the expected one', () => {
    expect(headcount(group({ id: 'g', confirmed_pax: 4, expected_pax: 9 }))).toBe(4)
    expect(headcount(group({ id: 'g', confirmed_pax: null, expected_pax: 9 }))).toBe(9)
  })
})

describe('memoisation on the record maps, not on the state object', () => {
  it('returns the same array when an unrelated record map changes', () => {
    const before = state()
    const roomsA = selectRoomsGrid(before)
    const queueA = selectQueueRows(before)

    // A call outcome touches only `groups` and `callStats`. The rooms grid
    // reads neither, so it must come back by IDENTITY — that is what stops the
    // Rooms board re-rendering when the Calls screen logs an outcome.
    const after = applyOps(before, [
      { t: 'group.patch', id: 'g-sharma', patch: { rsvp_status: 'declined' } },
    ])
    expect(selectRoomsGrid(after)).not.toBe(roomsA)
    expect(selectQueueRows(after)).not.toBe(queueA)

    // A write to an unrelated table is the case that matters.
    const legOnly = applyOps(before, [
      { t: 'leg.patch', id: 'leg-1', patch: { arrived_at: at(120) } },
    ])
    // The rooms grid reads guests/rooms/assignments/deliverables/hotels/groups,
    // so a leg stamp must not rebuild it.
    const roomsB = selectRoomsGrid(before)
    expect(selectRoomsGrid(legOnly)).toBe(roomsB)
  })
})

describe('optimistic ops for the rooms board', () => {
  it('lists a family guest who holds no bed', () => {
    expect(unplacedGuestIds(state(), 'g-sharma')).toEqual(['gu-2'])
    expect(unplacedGuestIds(state(), 'g-desai')).toEqual(['gu-3'])
  })

  it('places up to the requested count, and never more than are unplaced', () => {
    const ops = optimisticPlaceOps(state(), { groupId: 'g-sharma', roomId: 'r-1', count: 5 }, at(30))
    expect(ops).toHaveLength(1)
    const next = applyOps(state(), ops)
    expect(next.assignments['pending-gu-2']).toBeDefined()
    expect(selectRoomsGrid(next).rooms[0]?.freeBeds).toBe(0)
  })

  it('bumps the family shortfall through the derived grid, not a second counter', () => {
    const before = selectRoomsGrid(state())
    const ops = optimisticPlaceOps(state(), { groupId: 'g-sharma', roomId: 'r-1', count: 1 }, at(30))
    const after = selectRoomsGrid(applyOps(state(), ops))
    expect(after.totals.guestsWithBed).toBe(before.totals.guestsWithBed + 1)
    expect(after.underBedded[0]?.shortfall).toBe((before.underBedded[0]?.shortfall ?? 0) - 1)
  })

  it('adds one named guest on demand', () => {
    const ops = optimisticAddGuestOps(state(), { guestId: 'gu-3', roomId: 'r-1' }, at(30))
    const next = applyOps(state(), ops)
    // Desai's guest is now in the room and out of the waiting list; Sharma's
    // second guest is still waiting, because this write is about gu-3 alone.
    expect(selectRoomsGrid(next).unplaced.map((row) => row.guestId)).toEqual(['gu-2'])
  })

  it('removes an occupant and returns them to the waiting list', () => {
    const ops = optimisticRemoveOps({ assignmentId: 'a-1' })
    const next = applyOps(state(), ops)
    const grid = selectRoomsGrid(next)
    expect(grid.rooms[0]?.occupants).toHaveLength(0)
    expect(grid.unplaced.map((row) => row.guestId).sort()).toEqual(['gu-1', 'gu-2'])
  })

  it('reads back the assignment ids and the room label for a write', () => {
    expect(activeAssignmentIds(state(), 'g-sharma')).toEqual(['a-1'])
    expect(roomLabelFor(state(), 'r-1')).toBe('Grand Bhagwati A101')
    expect(legIdsFor(state(), 'g-sharma', 'arrival')).toEqual(['leg-1'])
    expect(legIdsFor(state(), 'g-sharma', 'departure')).toEqual(['leg-2'])
  })
})

describe('a client session sees only its own rows', () => {
  it('has no staff tables to read', () => {
    // A REAL client payload: the event header and `client`, nothing else. The
    // migration drops the staff arrays entirely, so this is the shape the
    // server actually sends.
    const base = twoFamilySnapshot()
    const clientState = stateFrom(
      rawSnapshot(
        {
          groups: undefined,
          guests: undefined,
          legs: undefined,
          callStats: undefined,
          hotels: undefined,
          rooms: undefined,
          assignments: undefined,
          deliverables: undefined,
          proofs: undefined,
          vehicles: undefined,
          trips: undefined,
          tripPassengers: undefined,
          staff: undefined,
          client: base.client,
        },
        'client',
      ),
    )
    expect(clientState.role).toBe('client')
    expect(Object.keys(clientState.client)).toHaveLength(3)
    // The server sends no staff arrays to a client; every selector over them
    // therefore returns empty rather than leaking.
    expect(selectQueueRows(clientState)).toEqual([])
    expect(selectRoomsGrid(clientState).rooms).toEqual([])
    expect(selectDeliveryRun(clientState)).toEqual([])
    expect(selectTravelRows(clientState, 'arrival')).toEqual([])
    expect(selectCheckInRows(clientState)).toEqual([])
    expect(selectTodayNumbers(clientState, '2026-12-20').totalGroups).toBe(0)
    // The client array itself is served.
    expect(selectClientRows(clientState)).toHaveLength(3)
  })

  it('refuses a staff projection even when the payload carries staff rows', () => {
    // Belt and braces: the fence is the server, but a malformed payload (or a
    // fixture, as here) must not be able to turn a client session into a
    // calling list. Same payload as a staff session, one field different.
    const smuggled = state({ role: 'client' } as never)
    expect(smuggled.role).toBe('client')
    expect(selectQueueRows(smuggled)).toEqual([])
    expect(Object.keys(smuggled.groups)).toHaveLength(2)
  })
})

describe('guest rows stay addressable', () => {
  it('keeps a guest whose group is missing out of the rooms grid but not out of guests', () => {
    const orphan = guest({ id: 'gu-orphan', group_id: 'g-gone', is_head: true })
    const orphanState = state({ guests: [orphan] })
    expect(orphanState.guests['gu-orphan']).toBeDefined()
    // Nothing renders it, because every projection joins through the group.
    expect(selectRoomsGrid(orphanState).unplaced).toEqual([])
  })
})
