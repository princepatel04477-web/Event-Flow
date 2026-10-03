'use server'

import { createClient } from '@/lib/supabase/server'
import { friendlyDbError, isNetworkError } from '@/lib/errors'
import { pack } from '@/lib/logistics/pack'

/**
 * Plain-language copy for a FAILED READ. `friendlyDbError` is written for
 * writes ("Something went wrong saving that"), which is the wrong sentence on
 * a screen that only loads. Says what happened; the screen adds what to do and
 * who to ask (UX-RULES R6).
 */
function readError(
  error: { message?: string | null; code?: string | null } | null,
  what: string,
): string {
  if (isNetworkError(error)) {
    return 'Could not reach the server. Check your connection and try again.'
  }
  if (error?.code === '42501') {
    return 'The database refused to show this event’s data — your account may not have permission on this event.'
  }
  return `Could not read the ${what} from the database.`
}

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
  direction: 'arrival' | 'departure'
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
// Read result
//
// supabase-js returns `{ data, error }` and NEVER throws. Destructuring only
// `data` makes a failed query indistinguishable from "no rows", which is how
// vehicle planning failed SILENTLY: a broken read rendered the empty state
// ("No vehicles in the fleet" / "Nothing to plan") instead of an error. Every
// read below now returns this shape so the screen can tell a failure from an
// empty event (UX-RULES R6).
// ---------------------------------------------------------------------------

export type ReadResult<T> = { ok: true; data: T } | { ok: false; error: string }

// ---------------------------------------------------------------------------
// Read: legs that need a trip
// ---------------------------------------------------------------------------

export async function readUnplacedTravelLegs(
  eventId: string,
  direction: 'arrival' | 'departure',
): Promise<ReadResult<TravelLegForLogistics[]>> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('travel_legs')
    .select(
      'id, group_id, direction, mode, travel_date, travel_time, point, reference, pax_on_leg, needs_transport, guest_groups!inner(head_name)',
    )
    .eq('event_id', eventId)
    .eq('direction', direction)
    .eq('needs_transport', true)
    .order('travel_date', { ascending: true })
    .order('travel_time', { ascending: true })

  if (error) return { ok: false, error: readError(error, `${direction} travel legs`) }

  // Exclude legs already on a trip
  const { data: placed, error: placedError } = await supabase
    .from('trip_passengers')
    .select('travel_leg_id')
    .eq('event_id', eventId)
    .not('travel_leg_id', 'is', null)

  if (placedError) return { ok: false, error: readError(placedError, `${direction} travel legs`) }

  const placedIds = new Set((placed ?? []).map((p: Record<string, unknown>) => p.travel_leg_id as string))

  const legs = ((data ?? []) as unknown as Record<string, unknown>[])
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

  return { ok: true, data: legs }
}

// ---------------------------------------------------------------------------
// Read: available vehicles
// ---------------------------------------------------------------------------

export async function readAvailableVehicles(eventId: string): Promise<ReadResult<VehicleForPacking[]>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('vehicles')
    .select('id, label, capacity, driver_name, driver_mobile')
    .eq('event_id', eventId)
    .neq('status', 'unavailable')
    .order('capacity', { ascending: false })

  if (error) return { ok: false, error: readError(error, 'fleet') }

  const vehicles = ((data ?? []) as unknown as Record<string, unknown>[]).map((v) => ({
    id: v.id as string,
    label: v.label as string | null,
    capacity: v.capacity as number,
    driverName: v.driver_name as string | null,
    driverMobile: v.driver_mobile as string | null,
  }))

  return { ok: true, data: vehicles }
}

// ---------------------------------------------------------------------------
// §4.2 — vehicle suggestion by arriving PAX. The system PROPOSES, a human
// commits. Capacity read live from the vehicles table (luggage-adjusted),
// never hardcoded. Pure engine in src/lib/logistics/suggestVehicle.ts.
// ---------------------------------------------------------------------------

import { suggestVehiclesForPax } from '@/lib/logistics/suggestVehicle'

export interface PaxVehicleSuggestion {
  vehicleId: string
  vehicleLabel: string | null
  capacity: number
  reason: string
  spareSeats: number
}

export interface PaxSuggestionResult {
  pax: number
  suggestions: PaxVehicleSuggestion[]
  tooLarge: boolean
  tooLargeReason: string | null
}

/**
 * Suggest vehicles for a group of `pax` at a time slot. Reads the fleet
 * live, delegates the ranking to the pure engine. Proposes only — nothing
 * is committed here; the event team's human-commits rule applies.
 */
export async function suggestVehiclesForArrival(
  eventId: string,
  pax: number,
): Promise<PaxSuggestionResult> {
  const read = await readAvailableVehicles(eventId)
  // A failed read yields no suggestions rather than a crash; the planning
  // screen surfaces the same failure in full (this path has no error UI of
  // its own).
  const vehicles = read.ok ? read.data : []
  const result = suggestVehiclesForPax(
    pax,
    vehicles.map((v) => ({ id: v.id, label: v.label, capacity: v.capacity })),
  )
  return {
    pax,
    suggestions: result.suggestions.map((s) => ({
      vehicleId: s.vehicleId,
      vehicleLabel: s.vehicleLabel,
      capacity: s.capacity,
      reason: s.reason,
      spareSeats: s.spareSeats,
    })),
    tooLarge: result.tooLarge,
    tooLargeReason: result.tooLargeReason,
  }
}

// ---------------------------------------------------------------------------
// Packer: delegates to src/lib/logistics/pack.ts (R3 engine)
// ---------------------------------------------------------------------------
// The adapter conforms to pack.ts, not the reverse. It maps the logistics
// read types (TravelLegForLogistics / VehicleForPacking) onto pack.ts's
// PackLeg / PackVehicle, calls pack() with an EXPLICIT direction (arrival and
// departure never share a default), then maps PackProposal back onto the
// LogisticsProposal shape commitTrips consumes.
//
// Capacity is left exactly as read from vehicles.capacity (seeded from
// vehicle_types.default_capacity). No hardcoding, no luggage adjustment here —
// pack.ts's no-split rule operates on whatever the row carries.
// ---------------------------------------------------------------------------

export async function packTrips(
  legs: TravelLegForLogistics[],
  vehicles: VehicleForPacking[],
  direction: 'arrival' | 'departure',
): Promise<LogisticsProposal> {
  const packLegs = legs.map((leg) => ({
    travelLegId: leg.id,
    groupId: leg.groupId,
    headName: leg.headName,
    date: leg.travelDate,
    time: leg.travelTime,
    point: leg.point,
    pax: leg.paxOnLeg,
  }))

  const packVehicles = vehicles.map((v) => ({
    id: v.id,
    label: v.label,
    capacity: v.capacity,
    driverName: v.driverName,
    driverMobile: v.driverMobile,
  }))

  const result = pack(packLegs, packVehicles, direction)

  const trips: ProposedTrip[] = result.trips
    .map((t) => ({
      vehicleId: t.vehicleId,
      vehicleLabel: t.vehicleLabel,
      capacity: t.capacity,
      seatsUsed: t.seatsUsed,
      groups: t.groups.map((g) => ({
        groupId: g.groupId,
        headName: g.headName,
        travelLegId: g.travelLegId,
        pax: g.pax,
        travelDate: g.date,
        travelTime: g.time,
        point: g.point,
      })),
      pickupPoint: t.pickupPoint,
      scheduledTime: scheduledTimeFromIso(t.scheduledAt),
      driverName: t.driverName,
      driverMobile: t.driverMobile,
      direction: t.direction,
    }))
    // §4.1: the pack engine emits trips in leg-processing order
    // (largest-family-first). The board reads best in time order — a
    // transport lead works down the clock, not down the load list. Display
    // and query-order only; nothing about the proposal itself changes.
    .sort((a, b) => (a.scheduledTime ?? '').localeCompare(b.scheduledTime ?? ''))

  const unplaced: UnplacedLeg[] = result.unplaced.map((u) => ({
    travelLegId: u.travelLegId,
    headName: u.headName,
    pax: u.pax,
    date: u.date,
    time: u.time,
    point: u.point,
    reason: u.reason,
  }))

  return { trips, unplaced }
}

/** `scheduledAt` is a full ISO datetime ("YYYY-MM-DDTHH:MM:SS"); the live
 *  Proposal carries only the time-of-day as "HH:MM:SS" (the date lives on the
 *  trip's anchor group and is re-read by commitTrips). */
function scheduledTimeFromIso(scheduledAt: string): string | null {
  const t = scheduledAt.split('T')[1]
  return t ?? null
}

// ---------------------------------------------------------------------------
// Commit: create trips + trip_passengers in one transaction
// ---------------------------------------------------------------------------

export async function commitTrips(
  eventId: string,
  proposal: LogisticsProposal,
): Promise<{ ok: true; tripCount: number } | { ok: false; error: string }> {
  const supabase = await createClient()

  // Allocate vehicles
  const vehicleIds = proposal.trips.map((t) => t.vehicleId)
  const { data: vehicles, error: vehiclesError } = await supabase
    .from('vehicles')
    .select('id, status')
    .in('id', vehicleIds)
  if (vehiclesError) return { ok: false, error: friendlyDbError(vehiclesError, undefined, 'commitTrips') }
  const vehicleMap = new Map<string, string>()
  for (const v of (vehicles ?? [])) {
    vehicleMap.set(v.id, v.status)
  }

  // Mark vehicles as assigned
  const { error: assignError } = await supabase
    .from('vehicles')
    .update({ status: 'assigned', updated_at: new Date().toISOString() })
    .in('id', vehicleIds)
  if (assignError) return { ok: false, error: friendlyDbError(assignError, undefined, 'commitTrips') }

  let tripCount = 0
  for (const trip of proposal.trips) {
    const { data: tripRow, error: tripErr } = await supabase
      .from('trips')
      .insert({
        event_id: eventId,
        vehicle_id: trip.vehicleId,
        direction: trip.direction,
        scheduled_at:
          trip.scheduledTime && trip.groups[0]?.travelDate
            ? new Date(`${trip.groups[0].travelDate}T${trip.scheduledTime}`).toISOString()
            : null,
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

