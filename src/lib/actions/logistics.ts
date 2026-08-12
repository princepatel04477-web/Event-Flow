import { supabase } from '@/lib/supabase/client'
import { friendlyDbError } from '@/lib/errors'
import {
  pack,
  type PackOptions,
  type PackProposal,
  type PackVehicle,
} from '@/lib/logistics/pack'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TravelLegForLogistics {
  id: string
  groupId: string
  headName: string
  direction: string
  mode: string | null
  travelDate: string | null
  travelTime: string | null
  point: string | null
  reference: string | null
  paxOnLeg: number
  needsTransport: boolean
}

export interface VehicleForPacking {
  id: string
  label: string | null
  capacity: number
  driverName: string | null
  driverMobile: string | null
}

export interface PackedGroup {
  groupId: string
  headName: string
  travelLegId: string
  pax: number
  travelDate: string | null
  travelTime: string | null
  point: string | null
}

export interface ProposedTrip {
  vehicleId: string
  vehicleLabel: string | null
  capacity: number
  seatsUsed: number
  groups: PackedGroup[]
  pickupPoint: string
  scheduledTime: string | null
  driverName: string | null
  driverMobile: string | null
}

export interface UnplacedLeg {
  travelLegId: string
  headName: string
  pax: number
  date: string | null
  time: string | null
  point: string | null
  reason: string
}

export interface LogisticsProposal {
  trips: ProposedTrip[]
  unplaced: UnplacedLeg[]
}

// ---------------------------------------------------------------------------
// Read: legs that need a trip
// ---------------------------------------------------------------------------

export async function readUnplacedTravelLegs(
  eventId: string,
  direction: 'arrival' | 'departure',
): Promise<TravelLegForLogistics[]> {

  const { data } = await supabase
    .from('travel_legs')
    .select(
      'id, group_id, direction, mode, travel_date, travel_time, point, reference, pax_on_leg, needs_transport, guest_groups!inner(head_name)',
    )
    .eq('event_id', eventId)
    .eq('direction', direction)
    .eq('needs_transport', true)
    .order('travel_date', { ascending: true })
    .order('travel_time', { ascending: true })

  // Exclude legs already on a trip
  const { data: placed } = await supabase
    .from('trip_passengers')
    .select('travel_leg_id')
    .eq('event_id', eventId)
    .not('travel_leg_id', 'is', null)

  const placedIds = new Set((placed ?? []).map((p: Record<string, unknown>) => p.travel_leg_id as string))

  return ((data ?? []) as unknown as Record<string, unknown>[])
    .filter((leg) => !placedIds.has(leg.id as string))
    .map((leg) => {
      const group = leg.guest_groups as { head_name: string } | null
      return {
        id: leg.id as string,
        groupId: leg.group_id as string,
        headName: group?.head_name ?? 'Unknown',
        direction: leg.direction as string,
        mode: leg.mode as string | null,
        travelDate: leg.travel_date as string | null,
        travelTime: leg.travel_time as string | null,
        point: leg.point as string | null,
        reference: leg.reference as string | null,
        paxOnLeg: (leg.pax_on_leg as number) ?? 1,
        needsTransport: leg.needs_transport as boolean,
      }
    })
}

// ---------------------------------------------------------------------------
// Read: available vehicles
// ---------------------------------------------------------------------------

export async function readAvailableVehicles(eventId: string): Promise<VehicleForPacking[]> {
  const { data } = await supabase
    .from('vehicles')
    .select('id, label, capacity, driver_name, driver_mobile')
    .eq('event_id', eventId)
    .neq('status', 'unavailable')
    .order('capacity', { ascending: false })

  return ((data ?? []) as unknown as Record<string, unknown>[]).map((v) => ({
    id: v.id as string,
    label: v.label as string | null,
    capacity: v.capacity as number,
    driverName: v.driver_name as string | null,
    driverMobile: v.driver_mobile as string | null,
  }))
}

// ---------------------------------------------------------------------------
// Packer: greedy, largest group first, 90-min window
// ---------------------------------------------------------------------------

const WINDOW_MINUTES = 90

export async function packTrips(
  legs: TravelLegForLogistics[],
  vehicles: VehicleForPacking[],
): Promise<LogisticsProposal> {
  // Sort: largest group first
  const sorted = [...legs].sort((a, b) => b.paxOnLeg - a.paxOnLeg)

  // Copy vehicles so we can mutate remaining capacity
  const fleet = vehicles.map((v) => ({ ...v, remaining: v.capacity }))
  const trips: ProposedTrip[] = []
  const unplaced: UnplacedLeg[] = []

  for (const leg of sorted) {
    if (leg.paxOnLeg <= 0) {
      unplaced.push({
        travelLegId: leg.id,
        headName: leg.headName,
        pax: leg.paxOnLeg,
        date: leg.travelDate,
        time: leg.travelTime,
        point: leg.point,
        reason: 'PAX is zero or unset',
      })
      continue
    }

    // Rule: never split a family unless PAX > largest vehicle
    const largestVehicle = [...fleet].sort((a, b) => b.remaining - a.remaining)[0]
    const mustSplit = largestVehicle && leg.paxOnLeg > largestVehicle.capacity

    // Try to fit in an existing trip within the 90-min window at the same point
    let placed = false
    for (const trip of trips) {
      if (trip.seatsUsed + leg.paxOnLeg > trip.capacity) continue
      if (!sameWindowAndPoint(trip, leg)) continue

      trip.groups.push({
        groupId: leg.groupId,
        headName: leg.headName,
        travelLegId: leg.id,
        pax: leg.paxOnLeg,
        travelDate: leg.travelDate,
        travelTime: leg.travelTime,
        point: leg.point,
      })
      trip.seatsUsed += leg.paxOnLeg
      placed = true
      break
    }
    if (placed) continue

    // Try a new vehicle
    for (const v of fleet) {
      if (v.remaining < leg.paxOnLeg) continue

      const trip: ProposedTrip = {
        vehicleId: v.id,
        vehicleLabel: v.label,
        capacity: v.capacity,
        seatsUsed: leg.paxOnLeg,
        groups: [
          {
            groupId: leg.groupId,
            headName: leg.headName,
            travelLegId: leg.id,
            pax: leg.paxOnLeg,
            travelDate: leg.travelDate,
            travelTime: leg.travelTime,
            point: leg.point,
          },
        ],
        pickupPoint: leg.point ?? 'Unknown',
        scheduledTime: leg.travelTime,
        driverName: v.driverName,
        driverMobile: v.driverMobile,
      }
      v.remaining -= leg.paxOnLeg
      trips.push(trip)
      placed = true
      break
    }
    if (placed) continue

    // Could not place
    let reason: string
    const totalAvailable = fleet.reduce((s, v) => s + v.remaining, 0)
    if (totalAvailable < leg.paxOnLeg) {
      reason = `Not enough seats across available vehicles (need ${leg.paxOnLeg}, have ${totalAvailable})`
    } else if (mustSplit) {
      reason = `Family PAX (${leg.paxOnLeg}) exceeds largest vehicle (${largestVehicle.capacity}) — would need to split`
    } else {
      reason = `Could not fit ${leg.paxOnLeg} PAX across available vehicles`
    }

    unplaced.push({
      travelLegId: leg.id,
      headName: leg.headName,
      pax: leg.paxOnLeg,
      date: leg.travelDate,
      time: leg.travelTime,
      point: leg.point,
      reason,
    })
  }

  return { trips, unplaced }
}

function sameWindowAndPoint(trip: ProposedTrip, leg: TravelLegForLogistics): boolean {
  if (!leg.travelTime || !trip.scheduledTime) return false
  if (trip.pickupPoint !== (leg.point ?? 'Unknown')) return false

  // Parse times as minutes since midnight for comparison
  const tripMins = timeToMinutes(trip.scheduledTime)
  const legMins = timeToMinutes(leg.travelTime)
  if (tripMins === null || legMins === null) return false

  return Math.abs(legMins - tripMins) <= WINDOW_MINUTES
}

function timeToMinutes(time: string): number | null {
  const parts = time.split(':').map(Number)
  if (parts.length < 2 || isNaN(parts[0]) || isNaN(parts[1])) return null
  return parts[0] * 60 + parts[1]
}

// ---------------------------------------------------------------------------
// Commit: create trips + trip_passengers in one transaction
// ---------------------------------------------------------------------------

export async function commitTrips(
  eventId: string,
  proposal: LogisticsProposal,
): Promise<{ ok: true; tripCount: number } | { ok: false; error: string }> {

  // Allocate vehicles
  const vehicleIds = proposal.trips.map((t) => t.vehicleId)
  const { data: vehicles } = await supabase
    .from('vehicles')
    .select('id, status')
    .in('id', vehicleIds)
  const vehicleMap = new Map<string, string>()
  for (const v of (vehicles ?? [])) {
    vehicleMap.set(v.id, v.status)
  }

  // Mark vehicles as assigned
  await supabase
    .from('vehicles')
    .update({ status: 'assigned', updated_at: new Date().toISOString() })
    .in('id', vehicleIds)

  let tripCount = 0
  for (const trip of proposal.trips) {
    const { data: tripRow, error: tripErr } = await supabase
      .from('trips')
      .insert({
        event_id: eventId,
        vehicle_id: trip.vehicleId,
        direction: trip.groups[0]?.travelDate ? 'arrival' : 'departure',
        scheduled_at: trip.scheduledTime ? new Date(`2000-01-01T${trip.scheduledTime}`).toISOString() : null,
        pickup_point: trip.pickupPoint,
        drop_point: null,
        driver_name: trip.driverName,
        driver_mobile: trip.driverMobile,
        status: 'planned',
        seats_capacity: trip.capacity,
      })
      .select('id')
      .single()

    if (tripErr) {
      return { ok: false, error: friendlyDbError(tripErr) }
    }

    // Insert passengers
    const passengerRows = trip.groups.map((g) => ({
      event_id: eventId,
      trip_id: tripRow.id,
      group_id: g.groupId,
      travel_leg_id: g.travelLegId,
      pax: g.pax,
    }))

    const { error: paxErr } = await supabase.from('trip_passengers').insert(passengerRows)
    if (paxErr) {
      return { ok: false, error: friendlyDbError(paxErr) }
    }

    tripCount++
  }

  return { ok: true, tripCount }
}

// ---------------------------------------------------------------------------
// R3: luggage-adjusted engine entry point + commit
// ---------------------------------------------------------------------------

export interface PackRequest {
  legs: {
    travelLegId: string
    groupId: string
    headName: string
    date: string | null
    time: string | null
    point: string | null
    pax: number
    hasElderly?: boolean
  }[]
  vehicles: PackVehicle[]
  direction: 'arrival' | 'departure'
  options?: Partial<PackOptions>
}

export interface PackResult {
  ok: boolean
  error: string | null
  proposal: PackProposal | null
}

/**
 * Run the R3 pack engine (luggage-adjusted, no-split, turnaround-aware)
 * over an explicit leg/vehicle set. Pure computation — nothing is written.
 */
export async function runPack(input: PackRequest): Promise<PackResult> {
  const proposal = pack(input.legs, input.vehicles, input.direction, {
    windowMinutes: input.options?.windowMinutes ?? 45,
    elderlyWindowMinutes: input.options?.elderlyWindowMinutes ?? 20,
    travelTimeToVenueMinutes: input.options?.travelTimeToVenueMinutes ?? 60,
    turnaroundBufferMinutes: input.options?.turnaroundBufferMinutes ?? 20,
    terminalBufferMinutes: input.options?.terminalBufferMinutes ?? 120,
    loadingBufferMinutes: input.options?.loadingBufferMinutes ?? 15,
  })
  return { ok: true, error: null, proposal }
}

/**
 * Commit an R3 pack proposal: create trips + trip_passengers, mark vehicles
 * assigned. Mirrors commitTrips but drives off the pack engine's shape.
 */
export async function commitPackProposal(
  eventId: string,
  proposal: PackProposal,
): Promise<{ ok: true; tripCount: number } | { ok: false; error: string }> {

  const vehicleIds = proposal.trips.map((t) => t.vehicleId)
  if (vehicleIds.length > 0) {
    await supabase
      .from('vehicles')
      .update({ status: 'assigned', updated_at: new Date().toISOString() })
      .in('id', vehicleIds)
  }

  let tripCount = 0
  for (const trip of proposal.trips) {
    const { data: tripRow, error: tripErr } = await supabase
      .from('trips')
      .insert({
        event_id: eventId,
        vehicle_id: trip.vehicleId,
        direction: trip.direction,
        scheduled_at: trip.scheduledAt,
        pickup_point: trip.pickupPoint,
        drop_point: null,
        driver_name: trip.driverName,
        driver_mobile: trip.driverMobile,
        status: 'planned',
        seats_capacity: trip.capacity,
      })
      .select('id')
      .single()

    if (tripErr) return { ok: false, error: friendlyDbError(tripErr) }

    const passengerRows = trip.groups.map((g) => ({
      event_id: eventId,
      trip_id: tripRow.id,
      group_id: g.groupId,
      travel_leg_id: g.travelLegId,
      pax: g.pax,
    }))
    const { error: paxErr } = await supabase.from('trip_passengers').insert(passengerRows)
    if (paxErr) return { ok: false, error: friendlyDbError(paxErr) }

    tripCount++
  }

  return { ok: true, tripCount }
}
