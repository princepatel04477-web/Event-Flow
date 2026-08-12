import { supabase } from '@/lib/supabase/client'
import { friendlyDbError } from '@/lib/errors'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DepartureGroup {
  groupId: string
  headName: string
  roomNumber: string | null
  hotelName: string | null
  pax: number
  existingLeg: ExistingDeparture | null
}

export interface ExistingDeparture {
  id: string
  mode: string | null
  travelDate: string | null
  travelTime: string | null
  point: string | null
  reference: string | null
  paxOnLeg: number | null
  source: string
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export async function searchDepartureGroups(
  eventId: string,
  query: string,
): Promise<DepartureGroup[]> {
  const term = `%${query}%`

  // Search by head name or room number
  const { data: groups } = await supabase
    .from('guest_groups')
    .select(
      'id, head_name, coalesce(confirmed_pax, expected_pax) as pax',
    )
    .eq('event_id', eventId)
    .ilike('head_name', term)
    .order('head_name', { ascending: true })
    .limit(20)
    .returns<{ id: string; head_name: string; pax: number }[]>()

  const { data: roomed } = await supabase
    .from('room_assignments')
    .select('group_id, rooms!inner(room_number, hotels!inner(name))')
    .eq('event_id', eventId)
    .is('released_at', null)
    .ilike('rooms.room_number', term)

  const { data: existingLegs } = await supabase
    .from('travel_legs')
    .select('id, group_id, mode, travel_date, travel_time, point, reference, pax_on_leg, source')
    .eq('event_id', eventId)
    .eq('direction', 'departure')
    .order('travel_date', { ascending: true })

  const legByGroup = new Map<string, ExistingDeparture>()
  for (const leg of (existingLegs ?? [])) {
    if (!legByGroup.has(leg.group_id)) {
      legByGroup.set(leg.group_id, {
        id: leg.id,
        mode: leg.mode,
        travelDate: leg.travel_date,
        travelTime: leg.travel_time,
        point: leg.point,
        reference: leg.reference,
        paxOnLeg: leg.pax_on_leg,
        source: leg.source,
      })
    }
  }

  // Merge room info
  const roomByGroup = new Map<string, { roomNumber: string; hotelName: string }>()
  for (const r of (roomed ?? [])) {
    const rooms = r.rooms as { room_number: string; hotels: { name: string } } | null
    if (rooms && !roomByGroup.has(r.group_id)) {
      roomByGroup.set(r.group_id, {
        roomNumber: rooms.room_number,
        hotelName: rooms.hotels?.name ?? 'Unknown',
      })
    }
  }

  // Also include room-matched groups that didn't match by name
  const roomMatchedGroupIds = new Set((roomed ?? []).map((r) => r.group_id))
  const nameMatchedIds = new Set((groups ?? []).map((g) => g.id))

  const extraIds = [...roomMatchedGroupIds].filter((id) => !nameMatchedIds.has(id))
  let extraGroups: { id: string; head_name: string; pax: number }[] = []
  if (extraIds.length > 0) {
    const { data: extras } = await supabase
      .from('guest_groups')
      .select('id, head_name, coalesce(confirmed_pax, expected_pax) as pax')
      .in('id', extraIds)
      .returns<{ id: string; head_name: string; pax: number }[]>()
    extraGroups = extras ?? []
  }

  const allGroups = [...(groups ?? []), ...extraGroups]

  return allGroups.map((g) => {
    const room = roomByGroup.get(g.id as string)
    return {
      groupId: g.id as string,
      headName: g.head_name as string,
      roomNumber: room?.roomNumber ?? null,
      hotelName: room?.hotelName ?? null,
      pax: (g.pax as number) ?? 0,
      existingLeg: legByGroup.get(g.id as string) ?? null,
    }
  })
}

// ---------------------------------------------------------------------------
// Write / Update departure leg
// ---------------------------------------------------------------------------

const departureSchema = z.object({
  eventId: z.string().uuid(),
  groupId: z.string().uuid(),
  travelDate: z.string().min(1, 'Date is required'),
  travelTime: z.string().min(1, 'Time is required'),
  mode: z.enum(['air', 'train', 'bus', 'cab', 'self_drive']),
  reference: z.string().optional(),
  dropPoint: z.string().optional(),
  paxOnLeg: z.number().int().positive('PAX must be positive'),
  expenseAmount: z.number().positive().nullable().optional(),
  expenseMode: z.enum(['cash', 'upi', 'vendor_bill']).nullable().optional(),
  expenseNotes: z.string().optional(),
})

export type DepartureInput = z.infer<typeof departureSchema>

export type DepartureResult =
  | { ok: true; legId: string; tripId: string | null }
  | { ok: false; error: string }

export async function saveDeparture(
  input: Omit<DepartureInput, 'eventId'> & { eventId: string; existingLegId: string | null },
): Promise<DepartureResult> {

  const parsed = departureSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') }
  }

  const source = 'event_team' as const
  const values = {
    mode: parsed.data.mode,
    travel_date: parsed.data.travelDate,
    travel_time: parsed.data.travelTime,
    reference: parsed.data.reference || null,
    point: parsed.data.dropPoint || null,
    pax_on_leg: parsed.data.paxOnLeg,
    source,
    updated_at: new Date().toISOString(),
  }

  let legId: string

  if (input.existingLegId) {
    const { error } = await supabase
      .from('travel_legs')
      .update(values)
      .eq('id', input.existingLegId)

    if (error) return { ok: false, error: friendlyDbError(error) }
    legId = input.existingLegId
  } else {
    const { data, error } = await supabase
      .from('travel_legs')
      .insert({
        event_id: input.eventId,
        group_id: parsed.data.groupId,
        direction: 'departure',
        ...values,
      })
      .select('id')
      .single()

    if (error) return { ok: false, error: friendlyDbError(error) }
    legId = data.id
  }

  // If cab, create/update a trip with expenses
  let tripId: string | null = null
  if (parsed.data.mode === 'cab' && parsed.data.expenseAmount != null && parsed.data.expenseAmount > 0) {
    const { data: cab, error: cabErr } = await supabase
      .from('trips')
      .insert({
        event_id: input.eventId,
        direction: 'departure',
        status: 'completed',
        seats_capacity: parsed.data.paxOnLeg,
        expense_amount: parsed.data.expenseAmount,
        expense_mode: parsed.data.expenseMode,
        expense_notes: parsed.data.expenseNotes || null,
        pickup_point: parsed.data.dropPoint,
        drop_point: parsed.data.dropPoint,
      })
      .select('id')
      .single()

    if (cabErr) return { ok: false, error: friendlyDbError(cabErr) }
    tripId = cab.id

    // Link passenger
    await supabase.from('trip_passengers').insert({
      event_id: input.eventId,
      trip_id: cab.id,
      group_id: parsed.data.groupId,
      travel_leg_id: legId,
      pax: parsed.data.paxOnLeg,
    })
  }

  return { ok: true, legId, tripId }
}

// ---------------------------------------------------------------------------
// Read: trips with expenses (for expense tab)
// ---------------------------------------------------------------------------

export interface TripExpense {
  tripId: string
  date: string | null
  headName: string
  route: string | null
  vehicleLabel: string | null
  driverName: string | null
  driverMobile: string | null
  pax: number
  amount: number
  mode: string | null
  notes: string | null
}

export async function readTripExpenses(eventId: string): Promise<TripExpense[]> {

  const { data } = await supabase
    .from('trips')
    .select(
      'id, scheduled_at, pickup_point, drop_point, driver_name, driver_mobile, seats_used, expense_amount, expense_mode, expense_notes, vehicles(label), trip_passengers(pax, group_id, guest_groups(head_name))',
    )
    .eq('event_id', eventId)
    .not('expense_amount', 'is', null)
    .gt('expense_amount', 0)
    .order('scheduled_at', { ascending: false })

  return ((data ?? []) as unknown as Record<string, unknown>[]).flatMap((t) => {
    const passengers = (t.trip_passengers as Record<string, unknown>[]) ?? []
    const vehicle = t.vehicles as { label: string } | null

    if (passengers.length === 0) {
      return [{
        tripId: t.id as string,
        date: t.scheduled_at as string | null,
        headName: 'Unknown',
        route: t.pickup_point as string | null,
        vehicleLabel: vehicle?.label ?? null,
        driverName: t.driver_name as string | null,
        driverMobile: t.driver_mobile as string | null,
        pax: t.seats_used as number,
        amount: t.expense_amount as number,
        mode: t.expense_mode as string | null,
        notes: t.expense_notes as string | null,
      }]
    }

    return passengers.map((p) => {
      const group = p.guest_groups as { head_name: string } | null
      return {
        tripId: t.id as string,
        date: t.scheduled_at as string | null,
        headName: group?.head_name ?? 'Unknown',
        route: t.pickup_point as string | null,
        vehicleLabel: vehicle?.label ?? null,
        driverName: t.driver_name as string | null,
        driverMobile: t.driver_mobile as string | null,
        pax: p.pax as number,
        amount: t.expense_amount as number,
        mode: t.expense_mode as string | null,
        notes: t.expense_notes as string | null,
      }
    })
  })
}

// ---------------------------------------------------------------------------
// Excel exports use xlsx in the client — we return data arrays
// ---------------------------------------------------------------------------

export interface LedgerRow {
  groupId: string
  headName: string
  pax: number
  arrivalLegs: number
  departureLegs: number
  state: string
}

export type LedgerFilter = 'all' | 'departure_missing' | 'no_arrival'

export async function readLedger(
  eventId: string,
  filter: LedgerFilter = 'all',
): Promise<{ rows: LedgerRow[]; summary: { total: number; balanced: number; unbalanced: number } }> {

  let query = supabase
    .from('v_travel_ledger')
    .select('group_id, head_name, pax, arrival_legs, departure_legs, ledger_state')
    .eq('event_id', eventId)

  if (filter !== 'all') {
    query = query.eq('ledger_state', filter)
  }

  const { data } = await query.order('head_name', { ascending: true })

  const rows: LedgerRow[] = ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    groupId: r.group_id as string,
    headName: r.head_name as string,
    pax: r.pax as number,
    arrivalLegs: r.arrival_legs as number,
    departureLegs: r.departure_legs as number,
    state: r.ledger_state as string,
  }))

  const total = rows.length
  const balanced = rows.filter((r) => r.state === 'balanced').length
  // Re-run unfiltered count for accurate total if filtering
  let totalAll = total
  let balancedAll = balanced
  if (filter !== 'all') {
    const { count } = await supabase
      .from('v_travel_ledger')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', eventId)
    totalAll = count ?? total
    const { count: balancedCount } = await supabase
      .from('v_travel_ledger')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', eventId)
      .eq('ledger_state', 'balanced')
    balancedAll = balancedCount ?? 0
  }

  return {
    rows,
    summary: {
      total: totalAll,
      balanced: balancedAll,
      unbalanced: totalAll - balancedAll,
    },
  }
}

// ---------------------------------------------------------------------------
// Driver sheet: per-trip summary
// ---------------------------------------------------------------------------

export interface DriverSheetTrip {
  tripId: string
  vehicleLabel: string | null
  driverName: string | null
  driverMobile: string | null
  scheduledTime: string | null
  pickupPoint: string | null
  dropPoint: string | null
  direction: string
  families: {
    headName: string
    pax: number
    contactNumber: string | null
  }[]
}

export async function readDriverSheets(eventId: string): Promise<DriverSheetTrip[]> {

  const { data } = await supabase
    .from('trips')
    .select(
      'id, direction, scheduled_at, pickup_point, drop_point, driver_name, driver_mobile, vehicles(label), trip_passengers(pax, group_id, guest_groups(head_name, primary_mobile))',
    )
    .eq('event_id', eventId)
    .eq('status', 'planned')
    .order('scheduled_at', { ascending: true })

  return ((data ?? []) as unknown as Record<string, unknown>[]).map((t) => {
    const passengers = (t.trip_passengers as Record<string, unknown>[]) ?? []
    const vehicle = t.vehicles as { label: string } | null

    return {
      tripId: t.id as string,
      vehicleLabel: vehicle?.label ?? null,
      driverName: t.driver_name as string | null,
      driverMobile: t.driver_mobile as string | null,
      scheduledTime: t.scheduled_at as string | null,
      pickupPoint: t.pickup_point as string | null,
      dropPoint: t.drop_point as string | null,
      direction: t.direction as string,
      families: passengers.map((p) => {
        const group = p.guest_groups as { head_name: string; primary_mobile: string | null } | null
        return {
          headName: group?.head_name ?? 'Unknown',
          pax: p.pax as number,
          contactNumber: group?.primary_mobile ?? null,
        }
      }),
    }
  })
}
