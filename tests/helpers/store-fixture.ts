import type {
  AssignmentRow,
  DeliverableRow,
  EventState,
  GroupRow,
  GuestRow,
  HotelRow,
  LegRow,
  RawSnapshot,
  RoomRow,
  SnapshotRole,
  StaffRow,
  TripPassengerRow,
  TripRow,
  VehicleRow,
} from '@/lib/store/types'
import { emptyState, parseSnapshot, stateFromSnapshot } from '@/lib/store/snapshot'

/**
 * Litre-sized versions of the rows the snapshot ships, for the store suites.
 *
 * Every builder fills EVERY field of its row type. That is the point: the store
 * derives its row types from the generated database types, so a field added by a
 * later migration fails these builders to compile — which is the earliest place
 * a shape change can be caught, and long before it reaches a phone.
 *
 * `at()` is a fixed instant, never `Date.now()`, so "is this lock still held" and
 * "is the watermark monotonic" are questions with one answer.
 */

export const EVENT_ID = '11111111-1111-4111-8111-111111111111'
export const OTHER_EVENT_ID = '22222222-2222-4222-8222-222222222222'

export function at(minutes = 0): string {
  return new Date(Date.UTC(2026, 11, 20, 10, 0, 0) + minutes * 60_000).toISOString()
}

export function group(over: Partial<GroupRow> & { id: string }): GroupRow {
  return {
    group_code: null,
    head_name: 'Sharma',
    primary_mobile: '9825011111',
    alt_mobile: null,
    side: 'bride',
    group_type: 'family',
    city: null,
    expected_pax: 6,
    confirmed_pax: null,
    rsvp_status: 'not_started',
    needs_return_gift: false,
    priority: 0,
    remarks: null,
    locked_by: null,
    locked_by_staff: null,
    locked_until: null,
    created_at: at(),
    updated_at: at(),
    created_by: null,
    created_by_staff: null,
    adults_confirmed: null,
    children_confirmed: null,
    needs_pickup: false,
    special_requirements: [],
    call_count: 0,
    callback_at: null,
    last_opened_at: null,
    last_opened_by_staff: null,
    ...over,
  }
}

export function guest(over: Partial<GuestRow> & { id: string; group_id: string }): GuestRow {
  return {
    full_name: 'Guest',
    mobile: null,
    is_head: false,
    age_band: 'adult',
    notes: null,
    created_at: at(),
    updated_at: at(),
    ...over,
  }
}

export function leg(over: Partial<LegRow> & { id: string; group_id: string }): LegRow {
  return {
    direction: 'arrival',
    mode: 'air',
    travel_date: '2026-12-20',
    travel_time: '10:30:00',
    reference: '6E 5074',
    point: 'AMD T2',
    pax_on_leg: 6,
    needs_transport: true,
    source: 'rsvp_call',
    notes: null,
    created_by: null,
    created_by_staff: null,
    created_at: at(),
    updated_at: at(),
    arrived_at: null,
    departed_at: null,
    ...over,
  }
}

export function hotel(over: Partial<HotelRow> & { id: string }): HotelRow {
  return {
    name: 'Grand Bhagwati',
    address: null,
    contact_name: null,
    contact_mobile: null,
    notes: null,
    created_at: at(),
    updated_at: at(),
    ...over,
  }
}

export function room(over: Partial<RoomRow> & { id: string; hotel_id: string }): RoomRow {
  return {
    room_number: 'A101',
    capacity: 2,
    max_capacity: 3,
    floor: '1',
    room_type: null,
    is_blocked: false,
    notes: null,
    created_at: at(),
    updated_at: at(),
    ...over,
  }
}

export function assignment(
  over: Partial<AssignmentRow> & { id: string; room_id: string; guest_id: string; group_id: string },
): AssignmentRow {
  return {
    assigned_at: at(),
    assigned_by: null,
    assigned_by_staff: null,
    check_in_date: '2026-12-20',
    check_in_time: null,
    check_out_date: '2026-12-24',
    check_out_time: null,
    checked_in_at: null,
    checked_out_at: null,
    created_at: at(),
    is_override: false,
    override_reason: null,
    release_reason: null,
    released_at: null,
    updated_at: at(),
    ...over,
  }
}

export function deliverable(
  over: Partial<DeliverableRow> & { id: string; group_id: string },
): DeliverableRow {
  return {
    guest_id: null,
    room_id: null,
    kind: 'hamper',
    item_name: 'Diwali hamper',
    quantity: 1,
    status: 'pending',
    assigned_to: null,
    notes: null,
    created_at: at(),
    updated_at: at(),
    ...over,
  }
}

export function staff(over: Partial<StaffRow> & { id: string }): StaffRow {
  return {
    full_name: 'Ravi Patel',
    department: 'hospitality',
    is_active: true,
    created_by: null,
    created_at: at(),
    updated_at: at(),
    ...over,
  }
}

export function vehicle(over: Partial<VehicleRow> & { id: string }): VehicleRow {
  return {
    vehicle_type_id: null,
    label: 'Innova #2',
    registration_no: null,
    capacity: 6,
    driver_name: null,
    driver_mobile: null,
    vendor_name: null,
    rate_note: null,
    status: 'available',
    notes: null,
    is_placeholder: false,
    created_by: null,
    created_by_staff: null,
    created_at: at(),
    updated_at: at(),
    ...over,
  }
}

export function trip(over: Partial<TripRow> & { id: string }): TripRow {
  return {
    vehicle_id: null,
    direction: 'arrival',
    scheduled_at: null,
    pickup_point: null,
    drop_point: null,
    driver_name: null,
    driver_mobile: null,
    driver_id: null,
    status: 'planned',
    seats_capacity: 6,
    seats_used: 0,
    expense_amount: null,
    expense_mode: null,
    expense_notes: null,
    created_by: null,
    created_by_staff: null,
    created_at: at(),
    updated_at: at(),
    ...over,
  }
}

export function tripPassenger(
  over: Partial<TripPassengerRow> & { id: string; trip_id: string; group_id: string },
): TripPassengerRow {
  return {
    travel_leg_id: null,
    pax: 6,
    created_at: at(),
    ...over,
  }
}

/** The payload as `app.event_snapshot` returns it — keys and all. */
export function rawSnapshot(
  over: Partial<RawSnapshot> = {},
  role: SnapshotRole = 'team',
): RawSnapshot {
  return {
    v: 1,
    role,
    at: at(),
    watermark: at(),
    deletesSeen: false,
    event: {
      id: EVENT_ID,
      code: 'SHARMA26',
      name: 'Sharma wedding',
      startsOn: '2026-12-20',
      endsOn: '2026-12-24',
      venueCity: 'Ahmedabad',
      brideName: 'Priya',
      groomName: 'Rahul',
      archivedAt: null,
    },
    groups: [],
    guests: [],
    legs: [],
    callStats: [],
    hotels: [],
    rooms: [],
    assignments: [],
    deliverables: [],
    proofs: [],
    vehicles: [],
    vehicleTypes: [],
    trips: [],
    tripPassengers: [],
    drivers: [],
    vehicleAssignments: [],
    odometer: [],
    staff: [],
    client: [],
    ...over,
  }
}

/** A small, complete event: two families, three guests, one room, one hamper. */
export function twoFamilySnapshot(): RawSnapshot {
  const sharma = group({ id: 'g-sharma', head_name: 'Sharma', rsvp_status: 'confirmed', confirmed_pax: 6 })
  const desai = group({ id: 'g-desai', head_name: 'Desai', rsvp_status: 'not_started', expected_pax: 3 })

  const guests = [
    guest({ id: 'gu-1', group_id: 'g-sharma', full_name: 'Ramesh Sharma', is_head: true, mobile: '9825011111' }),
    guest({ id: 'gu-2', group_id: 'g-sharma', full_name: 'Sita Sharma' }),
    guest({ id: 'gu-3', group_id: 'g-desai', full_name: 'Nilesh Desai', is_head: true, mobile: '9825022222' }),
  ]

  return rawSnapshot({
    groups: [sharma, desai],
    guests,
    legs: [
      leg({ id: 'leg-1', group_id: 'g-sharma' }),
      leg({
        id: 'leg-2',
        group_id: 'g-sharma',
        direction: 'departure',
        mode: 'cab',
        travel_date: null,
        travel_time: null,
        reference: null,
      }),
    ],
    callStats: [
      { groupId: 'g-sharma', n: 2, lastAt: at(-60), lastOutcome: 'connected', nextCallbackAt: null },
    ],
    hotels: [hotel({ id: 'h-1' })],
    rooms: [room({ id: 'r-1', hotel_id: 'h-1' })],
    assignments: [
      assignment({ id: 'a-1', room_id: 'r-1', guest_id: 'gu-1', group_id: 'g-sharma' }),
    ],
    deliverables: [
      deliverable({ id: 'd-1', group_id: 'g-sharma', status: 'delivered' }),
      deliverable({ id: 'd-2', group_id: 'g-desai', status: 'pending' }),
    ],
    vehicles: [vehicle({ id: 'v-1' })],
    trips: [trip({ id: 't-1', vehicle_id: 'v-1' })],
    tripPassengers: [tripPassenger({ id: 'tp-1', trip_id: 't-1', group_id: 'g-sharma' })],
    staff: [staff({ id: 's-1', full_name: 'Ravi Patel' })],
    client: [
      {
        event_id: EVENT_ID,
        guest_id: 'gu-1',
        guest_name: 'Ramesh Sharma',
        family_head: 'Sharma',
        group_type: 'family',
        side: 'bride',
        pax: 6,
        rsvp_status: 'confirmed',
        hotel_name: 'Grand Bhagwati',
        room_number: 'A101',
        arrival_date: '2026-12-20',
        arrival_time: '10:30:00',
        arrival_mode: 'air',
        arrival_point: 'AMD T2',
        departure_date: null,
        departure_time: null,
        departure_mode: null,
        departure_point: null,
        hamper_delivered: true,
        return_gift_delivered: null,
        needs_return_gift: false,
      },
      {
        event_id: EVENT_ID,
        guest_id: 'gu-2',
        guest_name: 'Sita Sharma',
        family_head: 'Sharma',
        group_type: 'family',
        side: 'bride',
        pax: 6,
        rsvp_status: 'confirmed',
        hotel_name: 'Grand Bhagwati',
        room_number: 'A101',
        arrival_date: '2026-12-20',
        arrival_time: '10:30:00',
        arrival_mode: 'air',
        arrival_point: 'AMD T2',
        departure_date: null,
        departure_time: null,
        departure_mode: null,
        departure_point: null,
        hamper_delivered: true,
        return_gift_delivered: null,
        needs_return_gift: false,
      },
      {
        event_id: EVENT_ID,
        guest_id: 'gu-3',
        guest_name: 'Nilesh Desai',
        family_head: 'Desai',
        group_type: 'family',
        side: 'bride',
        pax: 3,
        rsvp_status: 'not_started',
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
        hamper_delivered: false,
        return_gift_delivered: null,
        needs_return_gift: false,
      },
    ],
  })
}

/** Parse a payload or fail loudly, so a bad fixture names itself. */
export function stateFrom(raw: RawSnapshot, eventId = EVENT_ID): EventState {
  const parsed = parseSnapshot(raw)
  if (!parsed) throw new Error('fixture did not parse')
  return stateFromSnapshot(eventId, parsed.data, parsed.dropped)
}

/** An empty state, for cases that only exercise ops. */
export function empty(eventId = EVENT_ID): EventState {
  return emptyState(eventId)
}
