'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { friendlyDbError } from '@/lib/errors'
import { parseCapacity } from '@/lib/rooms/parse'

export type HotelActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { data?: undefined } : { data: T }))
  | { ok: false; error: string }

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error }
}

function revalidateHotels(eventCode: string, hotelId?: string) {
  revalidatePath('/admin/hotels')
  revalidatePath(`/admin/hotels?event=${eventCode}`)
  if (hotelId) revalidatePath(`/admin/hotels/${hotelId}/rooms`)
}

// ---------------------------------------------------------------------
// Hotels
// ---------------------------------------------------------------------

export interface HotelInput {
  name: string
  address: string
  contactName: string
  contactMobile: string
  notes: string
}

function cleanHotel(input: HotelInput) {
  const name = input.name.trim()
  if (!name) return { error: 'A hotel needs a name.' as const, values: null }
  return {
    error: null,
    values: {
      name,
      address: input.address.trim() || null,
      contact_name: input.contactName.trim() || null,
      contact_mobile: input.contactMobile.trim() || null,
      notes: input.notes.trim() || null,
    },
  }
}

export async function createHotel(
  eventId: string,
  eventCode: string,
  input: HotelInput,
): Promise<HotelActionResult<{ id: string }>> {
  const { error: invalid, values } = cleanHotel(input)
  if (invalid || !values) return fail(invalid ?? 'Invalid hotel.')

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('hotels')
    .insert({ event_id: eventId, ...values })
    .select('id')
    .single()

  if (error) {
    // `unique (event_id, name)` — say which constraint bit rather than
    // surfacing "duplicate key value violates unique constraint".
    if (error.code === '23505') {
      return fail(`There is already a hotel called "${values.name}" on this event.`)
    }
    return fail(friendlyDbError(error))
  }

  revalidateHotels(eventCode)
  return { ok: true, data: { id: data.id } }
}

export async function updateHotel(
  hotelId: string,
  eventId: string,
  eventCode: string,
  input: HotelInput,
): Promise<HotelActionResult> {
  const { error: invalid, values } = cleanHotel(input)
  if (invalid || !values) return fail(invalid ?? 'Invalid hotel.')

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('hotels')
    .update(values)
    .eq('id', hotelId)
    .eq('event_id', eventId)
    .select('id')

  if (error) {
    if (error.code === '23505') {
      return fail(`There is already a hotel called "${values.name}" on this event.`)
    }
    return fail(friendlyDbError(error))
  }
  // RLS refusals come back as zero rows and no error — never read the absence
  // of an error as success.
  if (!data || data.length === 0) {
    return fail('Nothing was updated — you may not have permission on this event.')
  }

  revalidateHotels(eventCode, hotelId)
  return { ok: true }
}

/**
 * Deleting a hotel cascades to its rooms, and from there to room assignments.
 * That is a lot of quiet destruction behind one tap, so it is refused while
 * any room exists — with a count, not a foreign-key error.
 */
export async function deleteHotel(
  hotelId: string,
  eventId: string,
  eventCode: string,
): Promise<HotelActionResult> {
  const supabase = await createClient()

  const { count, error: countError } = await supabase
    .from('rooms')
    .select('id', { count: 'exact', head: true })
    .eq('hotel_id', hotelId)
    .eq('event_id', eventId)

  if (countError) return fail(friendlyDbError(countError))

  if ((count ?? 0) > 0) {
    return fail(
      `This hotel still has ${count} room${count === 1 ? '' : 's'}. ` +
        `Delete the rooms first — removing the hotel would take every room and ` +
        `every guest's allocation with it.`,
    )
  }

  const { data, error } = await supabase
    .from('hotels')
    .delete()
    .eq('id', hotelId)
    .eq('event_id', eventId)
    .select('id')

  if (error) return fail(friendlyDbError(error))
  if (!data || data.length === 0) {
    return fail('Nothing was deleted — only an admin can remove a hotel.')
  }

  revalidateHotels(eventCode)
  return { ok: true }
}

// ---------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------

export interface RoomDraft {
  roomNumber: string
  roomType: string | null
  capacity: number
  floor: string | null
}

export interface CreateRoomsResult {
  created: number
  skipped: number
  skippedNumbers: string[]
}

/**
 * Create rooms, skipping any number that already exists in this hotel.
 *
 * Skipping rather than failing is the point: a client's list is added in
 * overlapping chunks, and a batch of forty that dies on the one number
 * somebody already typed is useless. `ignoreDuplicates` leans on
 * `unique (hotel_id, room_number)` so the skip is decided by the database,
 * not by a read-then-write race.
 */
export async function createRooms(
  hotelId: string,
  eventId: string,
  eventCode: string,
  drafts: RoomDraft[],
): Promise<HotelActionResult<CreateRoomsResult>> {
  if (drafts.length === 0) return fail('No rooms to create.')

  for (const draft of drafts) {
    const capacity = parseCapacity(draft.capacity)
    if (capacity.error) return fail(`Room ${draft.roomNumber}: ${capacity.error}`)
    if (!draft.roomNumber.trim()) return fail('A room needs a number.')
  }

  const supabase = await createClient()

  const { data: existing, error: readError } = await supabase
    .from('rooms')
    .select('room_number')
    .eq('hotel_id', hotelId)
    .eq('event_id', eventId)

  if (readError) return fail(friendlyDbError(readError))

  const present = new Set((existing ?? []).map((r) => r.room_number))
  const fresh = drafts.filter((d) => !present.has(d.roomNumber))
  const skippedNumbers = drafts.filter((d) => present.has(d.roomNumber)).map((d) => d.roomNumber)

  if (fresh.length === 0) {
    return {
      ok: true,
      data: { created: 0, skipped: skippedNumbers.length, skippedNumbers },
    }
  }

  const { data, error } = await supabase
    .from('rooms')
    .upsert(
      fresh.map((d) => ({
        event_id: eventId,
        hotel_id: hotelId,
        room_number: d.roomNumber,
        room_type: d.roomType,
        capacity: d.capacity,
        floor: d.floor,
      })),
      { onConflict: 'hotel_id,room_number', ignoreDuplicates: true },
    )
    .select('id')

  if (error) return fail(friendlyDbError(error))

  revalidateHotels(eventCode, hotelId)
  return {
    ok: true,
    data: {
      created: data?.length ?? 0,
      skipped: skippedNumbers.length,
      skippedNumbers,
    },
  }
}

export interface ImportRoomsResult {
  inserted: number
  updated: number
}

/**
 * Excel import of rooms, idempotent on `(hotel_id, room_number)`.
 *
 * Unlike `createRooms`, a repeat here UPDATES: the sheet is the client's
 * corrected list, so a changed capacity or floor should land rather than be
 * skipped. That is the documented difference between the two paths.
 */
export async function importRooms(
  hotelId: string,
  eventId: string,
  eventCode: string,
  drafts: RoomDraft[],
): Promise<HotelActionResult<ImportRoomsResult>> {
  if (drafts.length === 0) return fail('Nothing in that sheet to import.')

  const supabase = await createClient()

  const { data: before, error: readError } = await supabase
    .from('rooms')
    .select('room_number')
    .eq('hotel_id', hotelId)
    .eq('event_id', eventId)

  if (readError) return fail(friendlyDbError(readError))
  const present = new Set((before ?? []).map((r) => r.room_number))

  const { error } = await supabase.from('rooms').upsert(
    drafts.map((d) => ({
      event_id: eventId,
      hotel_id: hotelId,
      room_number: d.roomNumber,
      room_type: d.roomType,
      capacity: d.capacity,
      floor: d.floor,
    })),
    { onConflict: 'hotel_id,room_number' },
  )

  if (error) return fail(friendlyDbError(error))

  const updated = drafts.filter((d) => present.has(d.roomNumber)).length

  revalidateHotels(eventCode, hotelId)
  return { ok: true, data: { inserted: drafts.length - updated, updated } }
}

export async function deleteRoom(
  roomId: string,
  hotelId: string,
  eventId: string,
  eventCode: string,
): Promise<HotelActionResult> {
  const supabase = await createClient()

  const { count, error: countError } = await supabase
    .from('room_assignments')
    .select('id', { count: 'exact', head: true })
    .eq('room_id', roomId)
    .eq('event_id', eventId)
    .is('released_at', null)

  if (countError) return fail(friendlyDbError(countError))

  if ((count ?? 0) > 0) {
    return fail(
      `${count} guest${count === 1 ? ' is' : 's are'} still allocated to this room. ` +
        `Move them out before deleting it.`,
    )
  }

  const { data, error } = await supabase
    .from('rooms')
    .delete()
    .eq('id', roomId)
    .eq('event_id', eventId)
    .select('id')

  if (error) return fail(friendlyDbError(error))
  if (!data || data.length === 0) {
    return fail('Nothing was deleted — only an admin can remove a room.')
  }

  revalidateHotels(eventCode, hotelId)
  return { ok: true }
}
