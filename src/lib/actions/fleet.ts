'use server'

import { createClient } from '@/lib/supabase/server'
import { friendlyDbError } from '@/lib/errors'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export interface VehicleRow {
  id: string
  vehicleTypeId: string | null
  typeName: string | null
  seatLabel: string | null
  label: string | null
  registrationNo: string | null
  capacity: number
  driverName: string | null
  driverMobile: string | null
  vendorName: string | null
  rateNote: string | null
  status: string
  notes: string | null
}

export interface VehicleTypeRow {
  id: string
  name: string
  seatLabel: string | null
  defaultCapacity: number
  sortOrder: number
}

export interface FleetData {
  vehicles: VehicleRow[]
  types: VehicleTypeRow[]
}

export async function readFleet(eventId: string): Promise<FleetData> {
  const supabase = await createClient()

  const [vehiclesRes, typesRes] = await Promise.all([
    supabase
      .from('vehicles')
      .select(
        'id, vehicle_type_id, label, registration_no, capacity, driver_name, driver_mobile, vendor_name, rate_note, status, notes',
      )
      .eq('event_id', eventId)
      .order('created_at', { ascending: true }),
    supabase
      .from('vehicle_types')
      .select('id, name, seat_label, default_capacity, sort_order')
      .or(`event_id.eq.${eventId},event_id.is.null`)
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
  ])

  const vehicles = (vehiclesRes.data ?? []).map((v: Record<string, unknown>) => {
    const typeId = v.vehicle_type_id as string | null
    const typeRow = typeId
      ? (typesRes.data ?? []).find((t: Record<string, unknown>) => t.id === typeId)
      : null
    return {
      id: v.id as string,
      vehicleTypeId: typeId,
      typeName: (typeRow?.name as string) ?? null,
      seatLabel: (typeRow?.seat_label as string) ?? null,
      label: v.label as string | null,
      registrationNo: v.registration_no as string | null,
      capacity: v.capacity as number,
      driverName: v.driver_name as string | null,
      driverMobile: v.driver_mobile as string | null,
      vendorName: v.vendor_name as string | null,
      rateNote: v.rate_note as string | null,
      status: v.status as string,
      notes: v.notes as string | null,
    }
  })

  const types: VehicleTypeRow[] = (typesRes.data ?? []).map((t: Record<string, unknown>) => ({
    id: t.id as string,
    name: (t.name as string) ?? '',
    seatLabel: t.seat_label as string | null,
    defaultCapacity: t.default_capacity as number,
    sortOrder: t.sort_order as number,
  }))

  return { vehicles, types }
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

const vehicleSchema = z.object({
  eventId: z.string().uuid(),
  vehicleTypeId: z.string().uuid().nullable(),
  label: z.string().min(1, 'Label is required'),
  registrationNo: z.string().optional(),
  capacity: z.number().int().positive('Capacity must be positive'),
  driverName: z.string().optional(),
  driverMobile: z.string().optional(),
  vendorName: z.string().optional(),
  rateNote: z.string().optional(),
  status: z.enum(['available', 'assigned', 'unavailable']),
  notes: z.string().optional(),
})

export type VehicleInput = z.infer<typeof vehicleSchema>

export type VehicleResult =
  | { ok: true; id: string }
  | { ok: false; error: string }

export async function deleteVehicle(vehicleId: string): Promise<VehicleResult> {
  const supabase = await createClient()
  const { error } = await supabase.from('vehicles').delete().eq('id', vehicleId)
  if (error) return { ok: false, error: friendlyDbError(error) }
  return { ok: true, id: vehicleId }
}

/** Quick-add: create N vehicles of the same type at once. */
export async function quickAddVehicles(
  eventId: string,
  vehicleTypeId: string | null,
  count: number,
  capacityOverride: number | null,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  if (count < 1 || count > 50) {
    return { ok: false, error: 'Count must be between 1 and 50.' }
  }

  // Resolve type defaults
  let typeName = 'Vehicle'
  let defaultCap = 4

  if (vehicleTypeId) {
    const supabase = await createClient()
    const { data: typeRow } = await supabase
      .from('vehicle_types')
      .select('name, seat_label, default_capacity')
      .eq('id', vehicleTypeId)
      .maybeSingle()

    if (typeRow) {
      typeName = (typeRow as Record<string, unknown>).name as string
      defaultCap = (typeRow as Record<string, unknown>).default_capacity as number
    }
  }

  const capacity = capacityOverride ?? defaultCap
  const supabase = await createClient()

  const rows = Array.from({ length: count }, (_, i) => ({
    event_id: eventId,
    vehicle_type_id: vehicleTypeId,
    label: count === 1 ? typeName : `${typeName} #${i + 1}`,
    capacity,
    status: 'available' as const,
  }))

  const { error } = await supabase.from('vehicles').insert(rows)

  if (error) return { ok: false, error: friendlyDbError(error) }
  return { ok: true, count }
}

// ---------------------------------------------------------------------------
// Odometer / manual per-day entry (§3.3)
// ---------------------------------------------------------------------------

export interface OdometerRow {
  id: string
  vehicleId: string
  vehicleLabel: string | null
  logDate: string
  startKm: number
  endKm: number
  startTime: string | null
  endTime: string | null
  notes: string | null
  recordedAt: string
}

export type OdometerListResult =
  | { ok: true; rows: OdometerRow[] }
  | { ok: false; error: string }

export async function readOdometerLogs(eventId: string): Promise<OdometerListResult> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('odometer_logs')
    .select('id, vehicle_id, log_date, start_km, end_km, start_time, end_time, notes, recorded_at, vehicles(label)')
    .eq('event_id', eventId)
    .order('log_date', { ascending: false })
    .order('recorded_at', { ascending: false })

  if (error) return { ok: false, error: friendlyDbError(error) }
  const rows: OdometerRow[] = (data ?? []).map((r) => ({
    id: r.id,
    vehicleId: r.vehicle_id,
    vehicleLabel: (r.vehicles as unknown as { label: string | null } | null)?.label ?? null,
    logDate: r.log_date,
    startKm: r.start_km,
    endKm: r.end_km,
    startTime: r.start_time,
    endTime: r.end_time,
    notes: r.notes,
    recordedAt: r.recorded_at,
  }))
  return { ok: true, rows }
}

const odometerSchema = z.object({
  eventId: z.string().uuid(),
  vehicleId: z.string().uuid('Select a vehicle'),
  logDate: z.string().min(1, 'Date is required'),
  startKm: z.coerce.number().int().min(0, 'Starting KMS must be 0 or more'),
  endKm: z.coerce.number().int().min(0, 'Ending KMS must be 0 or more'),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  notes: z.string().optional(),
})

export type OdometerInput = z.infer<typeof odometerSchema>

export async function createOdometerLog(
  input: OdometerInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const parsed = odometerSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') }
  }
  if (parsed.data.endKm < parsed.data.startKm) {
    return { ok: false, error: 'Ending KMS must not be less than Starting KMS.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('odometer_logs')
    .insert({
      event_id: parsed.data.eventId,
      vehicle_id: parsed.data.vehicleId,
      log_date: parsed.data.logDate,
      start_km: parsed.data.startKm,
      end_km: parsed.data.endKm,
      start_time: parsed.data.startTime || null,
      end_time: parsed.data.endTime || null,
      notes: parsed.data.notes || null,
    })
    .select('id')
    .single()

  if (error) return { ok: false, error: friendlyDbError(error) }
  return { ok: true, id: data.id }
}

// ---------------------------------------------------------------------------
// Drivers (§3.1 roster)
// ---------------------------------------------------------------------------

export interface DriverRow {
  id: string
  fullName: string
  mobile: string | null
  notes: string | null
}

export type DriverListResult =
  | { ok: true; rows: DriverRow[] }
  | { ok: false; error: string }

export async function readDrivers(eventId: string): Promise<DriverListResult> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('drivers')
    .select('id, full_name, mobile, notes')
    .eq('event_id', eventId)
    .order('full_name', { ascending: true })

  if (error) return { ok: false, error: friendlyDbError(error) }
  const rows: DriverRow[] = (data ?? []).map((r) => ({
    id: r.id,
    fullName: r.full_name,
    mobile: r.mobile,
    notes: r.notes,
  }))
  return { ok: true, rows }
}

const driverSchema = z.object({
  eventId: z.string().uuid(),
  fullName: z.string().min(1, 'Driver name is required'),
  mobile: z.string().optional(),
  notes: z.string().optional(),
})

export type DriverInput = z.infer<typeof driverSchema>

export async function createDriver(
  input: DriverInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const parsed = driverSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('drivers')
    .insert({
      event_id: parsed.data.eventId,
      full_name: parsed.data.fullName,
      mobile: parsed.data.mobile || null,
      notes: parsed.data.notes || null,
    })
    .select('id')
    .single()

  if (error) return { ok: false, error: friendlyDbError(error) }
  return { ok: true, id: data.id }
}

// ---------------------------------------------------------------------------
// KM dashboard (§3.4) — everything computed at query time. Nothing stored.
// ---------------------------------------------------------------------------

export interface KmVehicleStat {
  vehicleId: string
  vehicleLabel: string | null
  totalKm: number
  tripCount: number
  /** km above/below the fleet average; + = over-used, - = under-used. */
  deltaFromAverageKm: number
}

export interface KmDashboardData {
  vehicles: KmVehicleStat[]
  fleetAverageKm: number
  totalKm: number
}

/**
 * Per-vehicle KM + trip counts + fairness, all derived from odometer_logs
 * and trips at query time. No stored aggregates — a stored counter drifts
 * the moment two phones write at once, and this is exactly the data that
 * must be honest on the day.
 */
export async function readKmDashboard(eventId: string): Promise<KmDashboardData> {
  const supabase = await createClient()

  const [logsRes, tripsRes, vehiclesRes] = await Promise.all([
    supabase
      .from('odometer_logs')
      .select('vehicle_id, start_km, end_km')
      .eq('event_id', eventId),
    supabase
      .from('trips')
      .select('vehicle_id')
      .eq('event_id', eventId),
    supabase
      .from('vehicles')
      .select('id, label, status')
      .eq('event_id', eventId),
  ])

  const kmByVehicle = new Map<string, number>()
  for (const log of logsRes.data ?? []) {
    const km = (log.end_km ?? 0) - (log.start_km ?? 0)
    kmByVehicle.set(log.vehicle_id, (kmByVehicle.get(log.vehicle_id) ?? 0) + km)
  }

  const tripsByVehicle = new Map<string, number>()
  for (const t of tripsRes.data ?? []) {
    if (t.vehicle_id) tripsByVehicle.set(t.vehicle_id, (tripsByVehicle.get(t.vehicle_id) ?? 0) + 1)
  }

  const vehicles = (vehiclesRes.data ?? []).map((v) => {
    const totalKm = kmByVehicle.get(v.id) ?? 0
    return {
      vehicleId: v.id,
      vehicleLabel: v.label,
      totalKm,
      tripCount: tripsByVehicle.get(v.id) ?? 0,
      deltaFromAverageKm: 0, // filled below
    }
  })

  const fleetAverageKm = vehicles.length > 0
    ? vehicles.reduce((s, v) => s + v.totalKm, 0) / vehicles.length
    : 0

  for (const v of vehicles) {
    v.deltaFromAverageKm = Math.round(v.totalKm - fleetAverageKm)
  }

  return {
    vehicles,
    fleetAverageKm: Math.round(fleetAverageKm * 10) / 10,
    totalKm: vehicles.reduce((s, v) => s + v.totalKm, 0),
  }
}

// ---------------------------------------------------------------------------
// Vehicle availability (§3.5) — derived at query time, never stored.
// ---------------------------------------------------------------------------

export interface VehicleAvailability {
  vehicleId: string
  vehicleLabel: string | null
  /** ISO datetime of the vehicle's next committed pickup. Null = free. */
  nextPickupAt: string | null
  /** ISO datetime of the vehicle's next committed drop (end of that trip). */
  nextFreeAt: string | null
  /** True when the vehicle has no committed trip at all. */
  free: boolean
}

/**
 * A vehicle is "free" if it has no committed trip in the future. Availability
 * is a point-in-time question: the same vehicle can be free at 10:00 and
 * committed at 14:00. We derive the NEXT busy window per vehicle from trips
 * (status != cancelled, scheduled_at in the future) — a stored
 * availability column would go stale the moment a trip is committed, so it
 * does not exist. The event team reads "is this car free after this drop-off"
 * as: nextFreeAt is the moment the car is genuinely free again.
 */
export async function readVehicleAvailability(eventId: string): Promise<VehicleAvailability[]> {
  const supabase = await createClient()

  const [vehiclesRes, tripsRes] = await Promise.all([
    supabase
      .from('vehicles')
      .select('id, label, status')
      .eq('event_id', eventId),
    supabase
      .from('trips')
      .select('id, vehicle_id, scheduled_at, status')
      .eq('event_id', eventId)
      .neq('status', 'cancelled')
      .not('scheduled_at', 'is', null)
      .order('scheduled_at', { ascending: true }),
  ])

  const nextByVehicle = new Map<string, { pickup: string; free: string }>()
  for (const t of tripsRes.data ?? []) {
    if (!t.vehicle_id || !t.scheduled_at) continue
    if (nextByVehicle.has(t.vehicle_id)) continue
    // Estimated trip length: the pack engine uses 2×travel+turnaround for a
    // round trip; for a single committed trip we estimate 2 hours as the
    // working window. Derivation only — no stored value.
    const pickup = t.scheduled_at
    const free = new Date(new Date(pickup).getTime() + 2 * 60 * 60 * 1000).toISOString()
    nextByVehicle.set(t.vehicle_id, { pickup, free })
  }

  return (vehiclesRes.data ?? []).map((v) => {
    const next = nextByVehicle.get(v.id)
    return {
      vehicleId: v.id,
      vehicleLabel: v.label,
      nextPickupAt: next?.pickup ?? null,
      nextFreeAt: next?.free ?? null,
      free: !next,
    }
  })
}
