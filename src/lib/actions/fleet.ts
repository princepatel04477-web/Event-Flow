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

export async function addVehicle(eventId: string, input: Omit<VehicleInput, 'eventId'>): Promise<VehicleResult> {
  const supabase = await createClient()

  const parsed = vehicleSchema.safeParse({ ...input, eventId })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') }
  }

  const { data, error } = await supabase
    .from('vehicles')
    .insert({
      event_id: eventId,
      vehicle_type_id: parsed.data.vehicleTypeId,
      label: parsed.data.label,
      registration_no: parsed.data.registrationNo || null,
      capacity: parsed.data.capacity,
      driver_name: parsed.data.driverName || null,
      driver_mobile: parsed.data.driverMobile || null,
      vendor_name: parsed.data.vendorName || null,
      rate_note: parsed.data.rateNote || null,
      status: parsed.data.status,
      notes: parsed.data.notes || null,
    })
    .select('id')
    .single()

  if (error) return { ok: false, error: friendlyDbError(error) }
  return { ok: true, id: data.id }
}

export async function updateVehicle(
  vehicleId: string,
  input: Omit<VehicleInput, 'eventId'>,
): Promise<VehicleResult> {
  const supabase = await createClient()

  const parsed = vehicleSchema.safeParse({ ...input, eventId: '00000000-0000-0000-0000-000000000000' })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => i.message).join('; ') }
  }

  const { error } = await supabase
    .from('vehicles')
    .update({
      vehicle_type_id: parsed.data.vehicleTypeId,
      label: parsed.data.label,
      registration_no: parsed.data.registrationNo || null,
      capacity: parsed.data.capacity,
      driver_name: parsed.data.driverName || null,
      driver_mobile: parsed.data.driverMobile || null,
      vendor_name: parsed.data.vendorName || null,
      rate_note: parsed.data.rateNote || null,
      status: parsed.data.status,
      notes: parsed.data.notes || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', vehicleId)

  if (error) return { ok: false, error: friendlyDbError(error) }
  return { ok: true, id: vehicleId }
}

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
