import { z } from 'zod'

import { supabase } from '@/lib/supabase/client'
// Client-reachable module: must not import queries.ts ('server-only').
import { getEventAccessClient } from '@/lib/supabase/queries-client'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function staffGate(access: string) {
  if (access !== 'admin' && access !== 'event_team') {
    return 'You are not staff on this event, so its data is invisible. Nothing was written.'
  }
  return null
}

// ---------------------------------------------------------------------------
// Hotels
// ---------------------------------------------------------------------------

const createHotelSchema = z.object({
  name: z.string().min(1, 'Hotel name is required'),
  address: z.string().nullable().optional(),
  contactName: z.string().nullable().optional(),
  contactMobile: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
})

export type CreateHotelInput = z.infer<typeof createHotelSchema>

export async function createHotel(eventId: string, raw: CreateHotelInput) {
  const access = await getEventAccessClient(eventId)
  const block = staffGate(access)
  if (block) return { ok: false as const, error: block }

  const parsed = createHotelSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }
  const { data, error } = await supabase
    .from('hotels')
    .insert({
      event_id: eventId,
      name: parsed.data.name,
      address: parsed.data.address ?? null,
      contact_name: parsed.data.contactName ?? null,
      contact_mobile: parsed.data.contactMobile ?? null,
      notes: parsed.data.notes ?? null,
    })
    .select('id')
    .single()

  if (error || !data) {
    if (error?.code === '23505') {
      return { ok: false as const, error: 'A hotel with that name already exists for this event.' }
    }
    return { ok: false as const, error: error?.message ?? 'Could not create hotel.' }
  }

  return { ok: true as const, hotelId: data.id }
}

export async function updateHotel(
  hotelId: string,
  eventId: string,
  patch: Partial<z.infer<typeof createHotelSchema>>,
) {
  const access = await getEventAccessClient(eventId)
  const block = staffGate(access)
  if (block) return { ok: false as const, error: block }
  const db: Record<string, string | null> = {}
  if (patch.name !== undefined) db.name = patch.name
  if (patch.address !== undefined) db.address = patch.address ?? null
  if (patch.contactName !== undefined) db.contact_name = patch.contactName ?? null
  if (patch.contactMobile !== undefined) db.contact_mobile = patch.contactMobile ?? null
  if (patch.notes !== undefined) db.notes = patch.notes ?? null

  if (Object.keys(db).length === 0) return { ok: true as const }

  const { error } = await supabase
    .from('hotels')
    .update(db as any)
    .eq('id', hotelId)
    .eq('event_id', eventId)

  if (error) {
    return { ok: false as const, error: error.message }
  }

  return { ok: true as const }
}

export async function deleteHotel(hotelId: string, eventId: string) {
  const access = await getEventAccessClient(eventId)
  if (access !== 'admin') return { ok: false as const, error: 'Only admins can delete hotels.' }

  // Check for active room allocations
  const { data: occupants } = await supabase
    .from('room_assignments')
    .select('room_id, rooms!inner(room_number), guests(full_name)')
    .eq('event_id', eventId)
    .is('released_at', null)
    .eq('rooms.hotel_id', hotelId)

  if (occupants && occupants.length > 0) {
    const names = occupants
      .slice(0, 5)
      .map((o: any) => `${o.guests?.full_name ?? 'Unknown'} (room ${o.rooms?.room_number ?? '?'})`)
    return {
      ok: false as const,
      error: `Cannot delete this hotel — ${occupants.length} active room assignment${occupants.length === 1 ? '' : 's'}.`,
      blockedBy: names,
    }
  }

  const { error } = await supabase
    .from('hotels')
    .delete()
    .eq('id', hotelId)
    .eq('event_id', eventId)

  if (error) {
    return { ok: false as const, error: error.message }
  }

  return { ok: true as const }
}

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------

const createRoomRangeSchema = z.object({
  prefix: z.string().default(''),
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  roomType: z.string().nullable().optional(),
  floor: z.string().nullable().optional(),
  capacity: z.number().int().min(1).default(2),
  notes: z.string().nullable().optional(),
})

const createSingleRoomSchema = z.object({
  roomNumber: z.string().min(1, 'Room number is required'),
  roomType: z.string().nullable().optional(),
  floor: z.string().nullable().optional(),
  capacity: z.number().int().min(1).default(2),
  notes: z.string().nullable().optional(),
})

export interface CreateRoomsResult {
  ok: boolean
  error?: string
  created: number
  skipped: number
}

export async function createRooms(
  eventId: string,
  hotelId: string,
  mode: 'range' | 'single',
  raw: unknown,
): Promise<CreateRoomsResult> {
  const access = await getEventAccessClient(eventId)
  const block = staffGate(access)
  if (block) return { ok: false, error: block, created: 0, skipped: 0 }

  if (mode === 'range') {
    const parsed = createRoomRangeSchema.safeParse(raw)
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message, created: 0, skipped: 0 }
    }

    const { prefix, start, end, roomType, floor, capacity, notes } = parsed.data
    if (end < start) {
      return { ok: false, error: 'End number must be >= start number.', created: 0, skipped: 0 }
    }

    const digits = String(end).length
    const rows = []
    for (let n = start; n <= end; n++) {
      rows.push({
        event_id: eventId,
        hotel_id: hotelId,
        room_number: prefix + String(n).padStart(digits, '0'),
        room_type: roomType ?? null,
        floor: floor ?? null,
        capacity,
        max_capacity: capacity + 1,
        notes: notes ?? null,
      })
    }
    let created = 0
    let skipped = 0
    for (const row of rows) {
      const { error } = await supabase.from('rooms').insert(row).select('id').single()
      if (error) {
        if (error.code === '23505') {
          skipped++
          continue
        }
        return { ok: false, error: `Room ${row.room_number}: ${error.message}`, created, skipped }
      }
      created++
    }

    return { ok: true, created, skipped }
  }

  // Single-room mode
  const parsed = createSingleRoomSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message, created: 0, skipped: 0 }
  }

  const { roomNumber, roomType, floor, capacity, notes } = parsed.data
  const { error } = await supabase.from('rooms').insert({
    event_id: eventId,
    hotel_id: hotelId,
    room_number: roomNumber,
    room_type: roomType ?? null,
    floor: floor ?? null,
    capacity,
    max_capacity: capacity + 1,
    notes: notes ?? null,
  }).select('id').single()

  if (error) {
    if (error.code === '23505') {
      return { ok: true, created: 0, skipped: 1 }
    }
    return { ok: false, error: error.message, created: 0, skipped: 0 }
  }

  return { ok: true, created: 1, skipped: 0 }
}

export async function updateRoom(
  roomId: string,
  eventId: string,
  patch: {
    roomNumber?: string
    roomType?: string | null
    floor?: string | null
    capacity?: number
    notes?: string | null
    isBlocked?: boolean
  },
) {
  const access = await getEventAccessClient(eventId)
  const block = staffGate(access)
  if (block) return { ok: false as const, error: block }
  const db: Record<string, boolean | string | number | null> = {}
  if (patch.roomNumber !== undefined) db.room_number = patch.roomNumber
  if (patch.roomType !== undefined) db.room_type = patch.roomType ?? null
  if (patch.floor !== undefined) db.floor = patch.floor ?? null
  if (patch.capacity !== undefined) {
    db.capacity = patch.capacity
    db.max_capacity = patch.capacity + 1
  }
  if (patch.notes !== undefined) db.notes = patch.notes ?? null
  if (patch.isBlocked !== undefined) db.is_blocked = patch.isBlocked

  if (Object.keys(db).length === 0) return { ok: true as const }

  const { error } = await supabase
    .from('rooms')
    .update(db as any)
    .eq('id', roomId)
    .eq('event_id', eventId)

  if (error) {
    if (error.code === '23505') {
      return { ok: false as const, error: 'A room with that number already exists in this hotel.' }
    }
    return { ok: false as const, error: error.message }
  }

  return { ok: true as const }
}

export async function deleteRoom(roomId: string, eventId: string) {
  const access = await getEventAccessClient(eventId)
  if (access !== 'admin') return { ok: false as const, error: 'Only admins can delete rooms.' }

  // Check for active allocations
  const { data: occupants, error: checkErr } = await supabase
    .from('room_assignments')
    .select('guest_id, guests!inner(full_name), group_id, guest_groups!inner(head_name)')
    .eq('room_id', roomId)
    .eq('event_id', eventId)
    .is('released_at', null)

  if (checkErr) {
    return { ok: false as const, error: checkErr.message }
  }

  if (occupants && occupants.length > 0) {
    const names = occupants
      .slice(0, 5)
      .map((o: any) => `${o.guests?.full_name ?? 'Unknown'} (${o.guest_groups?.head_name ?? '?'})`)
    return {
      ok: false as const,
      error: `Cannot delete — ${occupants.length} occupant${occupants.length === 1 ? '' : 's'} still assigned.`,
      blockedBy: names,
    }
  }

  const { error } = await supabase
    .from('rooms')
    .delete()
    .eq('id', roomId)
    .eq('event_id', eventId)

  if (error) {
    return { ok: false as const, error: error.message }
  }

  return { ok: true as const }
}
