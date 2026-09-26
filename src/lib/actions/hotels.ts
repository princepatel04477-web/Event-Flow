'use server'

import { z } from 'zod'

import { ROOM_TYPES, normaliseRoomType } from '@/lib/rooms/room-type'
import { createClient } from '@/lib/supabase/server'
import { getEventAccess } from '@/lib/supabase/queries'

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

/**
 * `.trim()` is not tidiness — it is what keeps the unique index meaningful.
 *
 * `hotels` is `unique (event_id, name)`, and Postgres compares the raw
 * string, so "Marriott" and "Marriott " are two different hotels as far as
 * that index is concerned. Nothing trimmed on the way in, so a trailing space
 * — which a phone keyboard adds readily, and which is invisible in every
 * screen that displays the name — bought a second row that looked identical
 * to the first. Two rows are already in the data this way ("Marriott " on
 * E00000, "Weekend Address " on E12345); see the duplicate check below.
 */
const createHotelSchema = z.object({
  name: z.string().trim().min(1, 'Hotel name is required'),
  address: z.string().trim().nullable().optional(),
  contactName: z.string().trim().nullable().optional(),
  contactMobile: z.string().trim().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
})

/**
 * Normalise for COMPARISON only — never for storage. Case-folded, ends
 * trimmed, internal runs of whitespace collapsed.
 *
 * Deliberately not more aggressive than that. Stripping punctuation would
 * also fuse "Hotel 1" and "Hotel-1", which are plausibly two real hotels,
 * and this check refuses the insert rather than merely flagging it. It
 * catches the failure mode that actually occurs — whitespace — and does not
 * pretend to catch misspellings: "Mariott" and "Marriott" are different
 * strings and no normaliser should be deciding otherwise.
 */
function normaliseHotelName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

export type CreateHotelInput = z.infer<typeof createHotelSchema>

export async function createHotel(eventId: string, raw: CreateHotelInput) {
  const access = await getEventAccess(eventId)
  const block = staffGate(access)
  if (block) return { ok: false as const, error: block }

  const parsed = createHotelSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()

  // Warn BEFORE inserting rather than letting the unique index decide. The
  // index only fires on a byte-exact match, so it would happily accept the
  // trailing-space twin it is supposed to prevent — and by then the row
  // exists and someone has to spot it by eye.
  const { data: siblings, error: siblingsError } = await supabase
    .from('hotels')
    .select('id, name')
    .eq('event_id', eventId)

  if (siblingsError) {
    return { ok: false as const, error: `Could not check for existing hotels: ${siblingsError.message}` }
  }

  const target = normaliseHotelName(parsed.data.name)
  const clash = (siblings ?? []).find((h) => normaliseHotelName(h.name) === target)
  if (clash) {
    return {
      ok: false as const,
      error:
        `"${clash.name}" already exists on this event. Open it instead of adding a ` +
        `second copy — or give this one a name that tells them apart.`,
      duplicateOf: clash.id,
    }
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
  const access = await getEventAccess(eventId)
  const block = staffGate(access)
  if (block) return { ok: false as const, error: block }

  const supabase = await createClient()
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
  const access = await getEventAccess(eventId)
  if (access !== 'admin') return { ok: false as const, error: 'Only admins can delete hotels.' }

  const supabase = await createClient()

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

/**
 * The bulk-create payload. Mirrors create_rooms_bulk()'s named arguments,
 * minus event_id/hotel_id which travel as function arguments.
 *
 * `roomType` is a closed enum, not a free string: the database CHECK rejects
 * anything else, and a write of ten rooms should fail once with a readable
 * message rather than ten times with a constraint name.
 */
const createRoomBulkSchema = z.object({
  roomType: z.enum(ROOM_TYPES),
  qty: z
    .number()
    .int()
    .min(1, 'Quantity must be at least 1')
    .max(500, 'At most 500 rooms at a time'),
  startNumber: z.number().int().min(0, 'Starting number must be 0 or more'),
  prefix: z.string().default(''),
  capacity: z.number().int().min(1).default(2),
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
  /**
   * Room numbers that already existed and were left alone. The bulk RPC
   * returns these explicitly (ON CONFLICT on `unique (hotel_id,
   * room_number)`), because "10 asked for, 8 created" is alarming without
   * the two names.
   */
  skipped: string[]
}

export async function createRooms(
  eventId: string,
  hotelId: string,
  mode: 'range' | 'single',
  raw: unknown,
): Promise<CreateRoomsResult> {
  const access = await getEventAccess(eventId)
  const block = staffGate(access)
  if (block) return { ok: false, error: block, created: 0, skipped: [] }

  if (mode === 'range') {
    const parsed = createRoomBulkSchema.safeParse(raw)
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0]?.message, created: 0, skipped: [] }
    }

    const { roomType, qty, startNumber, prefix, capacity } = parsed.data

    // One RPC, one transaction, and it reports what it skipped. The path this
    // replaces inserted row by row and returned on the first non-unique error,
    // so a 10-room range against a hotel already holding 3 reported "3
    // created" and silently dropped the other 7.
    const supabase = await createClient()
    const { data, error } = await supabase.rpc('create_rooms_bulk', {
      p_event_id: eventId,
      p_hotel_id: hotelId,
      p_room_type: roomType,
      p_qty: qty,
      p_start_number: startNumber,
      p_prefix: prefix,
      p_capacity: capacity,
    })

    if (error) {
      return { ok: false, error: error.message, created: 0, skipped: [] }
    }

    const payload = (data ?? {}) as { created?: number; skipped?: unknown }
    const skipped = Array.isArray(payload.skipped) ? payload.skipped.map(String) : []
    return { ok: true, created: payload.created ?? 0, skipped }
  }

  // Single-room mode
  const parsed = createSingleRoomSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message, created: 0, skipped: [] }
  }

  const { roomNumber, roomType, floor, capacity, notes } = parsed.data

  const supabase = await createClient()
  const { error } = await supabase.from('rooms').insert({
    event_id: eventId,
    hotel_id: hotelId,
    room_number: roomNumber,
    // Folded to the fixed vocabulary, or null when it is not one of the five.
    // The single-room screen sends a value from that list; the importer and
    // any older client could still send 'Twin'.
    room_type: normaliseRoomType(roomType),
    floor: floor ?? null,
    capacity,
    max_capacity: capacity + 1,
    notes: notes ?? null,
  }).select('id').single()

  if (error) {
    if (error.code === '23505') {
      return { ok: true, created: 0, skipped: [roomNumber] }
    }
    return { ok: false, error: error.message, created: 0, skipped: [] }
  }

  return { ok: true, created: 1, skipped: [] }
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
  const access = await getEventAccess(eventId)
  const block = staffGate(access)
  if (block) return { ok: false as const, error: block }

  const supabase = await createClient()
  const db: Record<string, boolean | string | number | null> = {}
  if (patch.roomNumber !== undefined) db.room_number = patch.roomNumber
  if (patch.roomType !== undefined) db.room_type = normaliseRoomType(patch.roomType)
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
  const access = await getEventAccess(eventId)
  if (access !== 'admin') return { ok: false as const, error: 'Only admins can delete rooms.' }

  const supabase = await createClient()

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
