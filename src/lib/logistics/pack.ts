/**
 * R3 — vehicle packing engine (arrivals + departures). SUGGESTS; a human
 * CONFIRMS.
 *
 * The core rules, all enforced here and again by the database:
 *
 *   - Capacity is LUGGAGE-ADJUSTED. The engine only ever sees the
 *     luggage-adjusted number — never the seat label. A 17-seat Tempo
 *     Traveller packs 12 wedding guests with bags, and the engine must not
 *     strand people by counting seats.
 *   - A family is NEVER split across two vehicles. A family of 6 goes
 *     together or waits for a vehicle that fits them.
 *   - Departures compute pickup time BACKWARDS from the flight/train time
 *     with configured buffers.
 *   - A vehicle can run a second trip only if the turnaround window is
 *     respected (next pickup >= previous pickup + 2×travel + buffer).
 *
 * Pure: no DOM, no Supabase, no clock — the same inputs produce the same
 * plan, so a re-run is a pure function of the data.
 */

export interface PackLeg {
  /** travel_legs.id — idempotency key. */
  travelLegId: string
  groupId: string
  headName: string
  /** ISO date, or null when unknown. */
  date: string | null
  /** "HH:MM", or null. */
  time: string | null
  /** Pickup/drop point (free text or pickup_points.name). */
  point: string | null
  /** Luggage-adjusted occupancy of this family. */
  pax: number
  /** True when the family has elderly members — tighter windows. */
  hasElderly?: boolean
}

export interface PackVehicle {
  id: string
  label: string | null
  /** LUGGAGE-ADJUSTED capacity. The only number this engine uses. */
  capacity: number
  driverName: string | null
  driverMobile: string | null
}

export interface PackedGroup extends PackLeg {
  /** Computed pickup time for this family within the trip. */
  pickupTime: string
}

export interface ProposedTrip {
  vehicleId: string
  vehicleLabel: string | null
  capacity: number
  seatsUsed: number
  groups: PackedGroup[]
  pickupPoint: string
  /** ISO datetime of the trip pickup. */
  scheduledAt: string
  driverName: string | null
  driverMobile: string | null
  direction: 'arrival' | 'departure'
  /** Minutes the first family waits for the last. */
  maxWaitMinutes: number
  /** True when maxWaitMinutes exceeds the window — flag for review. */
  waitFlagged: boolean
  /** Earliest pickup in the trip, in minutes — for window/join checks. */
  pickupMinutes: number
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

export interface PackProposal {
  trips: ProposedTrip[]
  unplaced: UnplacedLeg[]
}

export interface PackOptions {
  /** Minutes families arriving in the same window can share a vehicle. */
  windowMinutes: number
  /** Minutes for elderly families (they wait less). */
  elderlyWindowMinutes: number
  /** Minutes of travel time from pickup point to the venue. */
  travelTimeToVenueMinutes: number
  /** Minutes of turnaround buffer between trips of one vehicle. */
  turnaroundBufferMinutes: number
  /** Direction-specific terminal buffer (departures only). */
  terminalBufferMinutes: number
  /** Extra loading buffer (departures only). */
  loadingBufferMinutes: number
}

export const DEFAULT_PACK_OPTIONS: PackOptions = {
  windowMinutes: 45,
  elderlyWindowMinutes: 20,
  travelTimeToVenueMinutes: 60,
  turnaroundBufferMinutes: 20,
  terminalBufferMinutes: 120, // domestic flight default
  loadingBufferMinutes: 15,
}

function toMinutes(hhmm: string | null): number | null {
  if (!hhmm) return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

function toHHMM(total: number): string {
  const wrapped = ((Math.round(total) % 1440) + 1440) % 1440
  const h = Math.floor(wrapped / 60)
  const m = wrapped % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** A family's pickup time. Arrivals: the leg time itself. Departures:
 *  computed backwards from the leg time (the "flight time") minus travel,
 *  terminal and loading buffers. */
function pickupTimeMinutes(leg: PackLeg, options: PackOptions, direction: 'arrival' | 'departure'): number | null {
  const t = toMinutes(leg.time)
  if (t === null) return null
  if (direction === 'arrival') return t
  return t - options.travelTimeToVenueMinutes - options.terminalBufferMinutes - options.loadingBufferMinutes
}

/**
 * Bin-pack families into vehicles for one direction. Families are sorted
 * largest-first (hardest to place first), bucketed by (point, time window),
 * then packed smallest-vehicle-that-fits. A family is never split.
 */
export function pack(
  legs: PackLeg[],
  vehicles: PackVehicle[],
  direction: 'arrival' | 'departure',
  options: PackOptions = DEFAULT_PACK_OPTIONS,
): PackProposal {
  const unplaced: UnplacedLeg[] = []
  const trips: ProposedTrip[] = []

  // Sort largest first, then by time.
  const sorted = [...legs].sort((a, b) => b.pax - a.pax || (a.time ?? '').localeCompare(b.time ?? ''))

  // Each vehicle can run multiple trips; track its last finish time so a
  // reuse respects the turnaround buffer.
  const vehicleNextAvailable = new Map<string, number>()

  for (const leg of sorted) {
    const pickup = pickupTimeMinutes(leg, options, direction)
    if (pickup === null) {
      unplaced.push({
        travelLegId: leg.travelLegId,
        headName: leg.headName,
        pax: leg.pax,
        date: leg.date,
        time: leg.time,
        point: leg.point,
        reason: 'No pickup time on this leg — set the travel time first.',
      })
      continue
    }

    const window = leg.hasElderly ? options.elderlyWindowMinutes : options.windowMinutes

    // Is there an existing trip this family fits into (same point, time
    // within the window, capacity available, turnaround respected)?
    let placed = false
    for (const trip of trips) {
      if (trip.pickupPoint !== (leg.point ?? '') || trip.direction !== direction) continue
      const tripPickup = trip.pickupMinutes
      const sameWindow = Math.abs(pickup - tripPickup) <= window
      const capacityLeft = trip.capacity - trip.seatsUsed
      const fits = leg.pax <= capacityLeft
      if (sameWindow && fits) {
        trip.groups.push({
          ...leg,
          pickupTime: toHHMM(pickup),
        })
        trip.seatsUsed += leg.pax
        // maxWait: the earliest family waits until the latest pickup.
        trip.maxWaitMinutes = Math.max(trip.maxWaitMinutes, pickup - tripPickup)
        trip.waitFlagged = trip.maxWaitMinutes > window
        placed = true
        break
      }
    }
    if (placed) continue

    // Otherwise: find the smallest vehicle that fits the whole family AND
    // respects turnaround.
    const available = vehicles
      .filter((v) => v.capacity >= leg.pax)
      .sort((a, b) => a.capacity - b.capacity)

    let used: PackVehicle | null = null
    for (const v of available) {
      const nextAvail = vehicleNextAvailable.get(v.id) ?? -Infinity
      if (pickup >= nextAvail) {
        used = v
        break
      }
    }

    if (!used) {
      // A family alone exceeds the largest vehicle (or all vehicles are
      // mid-turnaround). Flag for manual multi-vehicle handling — never split.
      unplaced.push({
        travelLegId: leg.travelLegId,
        headName: leg.headName,
        pax: leg.pax,
        date: leg.date,
        time: leg.time,
        point: leg.point,
        reason: `No single vehicle can take ${leg.pax} people within the window. Assign by hand.`,
      })
      continue
    }

    const scheduledAt = toHHMM(pickup)
    trips.push({
      vehicleId: used.id,
      vehicleLabel: used.label,
      capacity: used.capacity,
      seatsUsed: leg.pax,
      groups: [{ ...leg, pickupTime: scheduledAt }],
      pickupPoint: leg.point ?? '',
      scheduledAt: `${leg.date ?? '2000-01-01'}T${scheduledAt}:00`,
      driverName: used.driverName,
      driverMobile: used.driverMobile,
      direction,
      maxWaitMinutes: 0,
      waitFlagged: false,
      pickupMinutes: pickup,
    })

    // Vehicle reuse: the next trip on this vehicle must be after this
    // pickup + travel + travel + buffer (a round trip and a buffer).
    const travel = options.travelTimeToVenueMinutes
    vehicleNextAvailable.set(used.id, pickup + 2 * travel + options.turnaroundBufferMinutes)
  }

  return { trips, unplaced }
}
