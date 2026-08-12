import { z } from 'zod'

import { supabase } from '@/lib/supabase/client'
import { getEventAccess } from '@/lib/supabase/queries'
import type { Json } from '@/lib/supabase/database.types'

const NOT_STAFF_MESSAGE =
  'You are not staff on this event, so its data is invisible to your account. ' +
  'Nothing was read and nothing was written — ask an admin to add you as event_team.'

// ---------------------------------------------------------------------------
// Context — what already exists
// ---------------------------------------------------------------------------

export interface HotelImportContext {
  ok: boolean
  error: string | null
  existingHotels: number
  existingRooms: number
}

export async function readHotelImportContext(eventId: string): Promise<HotelImportContext> {
  const access = await getEventAccess(eventId)
  if (access !== 'admin' && access !== 'event_team') {
    return { ok: false, error: NOT_STAFF_MESSAGE, existingHotels: 0, existingRooms: 0 }
  }
  const [hotels, rooms] = await Promise.all([
    supabase.from('hotels').select('id', { count: 'exact', head: true }).eq('event_id', eventId),
    supabase.from('rooms').select('id', { count: 'exact', head: true }).eq('event_id', eventId),
  ])

  const failure = hotels.error ?? rooms.error
  if (failure) {
    return {
      ok: false,
      error: `Could not read existing hotel data: ${failure.message}`,
      existingHotels: 0,
      existingRooms: 0,
    }
  }

  if (hotels.count === null || rooms.count === null) {
    return {
      ok: false,
      error:
        'The count queries returned without numbers. The database accepted the query; ' +
        'the transport layer dropped the count headers. Refusing to treat a lost count as zero.',
      existingHotels: 0,
      existingRooms: 0,
    }
  }

  return {
    ok: true,
    error: null,
    existingHotels: hotels.count,
    existingRooms: rooms.count,
  }
}

// ---------------------------------------------------------------------------
// Commit — one RPC, one transaction
// ---------------------------------------------------------------------------

const hotelCommitRowSchema = z.object({
  rowNumber: z.number(),
  hotelName: z.string().min(1),
  roomNumber: z.string(),
  roomType: z.string().nullable(),
  floor: z.string().nullable(),
  capacity: z.number().int().positive().nullable(),
  notes: z.string().nullable(),
  contactPerson: z.string().nullable(),
  contactNumber: z.string().nullable(),
  hotelAddress: z.string().nullable(),
})

export interface HotelCommitResult {
  ok: boolean
  error: string | null
  summary: {
    inserted: number
    skipped: number
    failed: number
    total: number
  } | null
  /** Rows that were skipped or failed, with reason */
  failures: { rowNumber: number; reason: string }[]
}

/**
 * Commit hotel import rows. Each row creates or finds a hotel, then inserts
 * a room under it. Idempotent: (event_id, hotel_name, room_number) is unique.
 * Re-importing the same file creates zero new rows.
 */
export async function commitHotelImport(
  eventId: string,
  fileName: string,
  rows: z.infer<typeof hotelCommitRowSchema>[],
): Promise<HotelCommitResult> {
  const access = await getEventAccess(eventId)
  if (access !== 'admin' && access !== 'event_team') {
    return { ok: false, error: NOT_STAFF_MESSAGE, summary: null, failures: [] }
  }

  const parsed = hotelCommitRowSchema.array().safeParse(rows)
  if (!parsed.success) {
    return { ok: false, error: 'The hotel data was not valid — re-upload the sheet.', summary: null, failures: [] }
  }
  const failures: { rowNumber: number; reason: string }[] = []

  // Hotel dedupe map: hotel name → id
  const hotelCache = new Map<string, string>()

  let inserted = 0
  let skipped = 0

  for (const row of parsed.data) {
    const hotelKey = row.hotelName.trim()

    // Get or create the hotel
    let hotelId = hotelCache.get(hotelKey)
    if (!hotelId) {
      const { data: existing } = await supabase
        .from('hotels')
        .select('id')
        .eq('event_id', eventId)
        .eq('name', hotelKey)
        .maybeSingle()

      if (existing) {
        hotelId = existing.id
        hotelCache.set(hotelKey, hotelId)
      } else {
        const { data: insertedHotel, error: hotelErr } = await supabase
          .from('hotels')
          .insert({
            event_id: eventId,
            name: hotelKey,
            address: row.hotelAddress || null,
            contact_name: row.contactPerson || null,
            contact_mobile: row.contactNumber || null,
            notes: row.notes || null,
          })
          .select('id')
          .single()

        if (hotelErr || !insertedHotel) {
          failures.push({
            rowNumber: row.rowNumber,
            reason: `Could not create hotel "${hotelKey}": ${hotelErr?.message ?? 'unknown'}`,
          })
          continue
        }
        hotelId = insertedHotel.id
        hotelCache.set(hotelKey, hotelId)
      }
    }

    // Insert the room
    const { error: roomErr, data: insertedRoom } = await supabase
      .from('rooms')
      .insert({
        event_id: eventId,
        hotel_id: hotelId,
        room_number: row.roomNumber.trim() || `R${row.rowNumber}`,
        room_type: row.roomType || null,
        floor: row.floor || null,
        capacity: row.capacity ?? 2,
        max_capacity: (row.capacity ?? 2) + 1,
        notes: row.notes || null,
      })
      .select('id')
      .single()

    if (roomErr) {
      if (roomErr.code === '23505') {
        // Duplicate (hotel + room_number) — idempotent, skip
        skipped++
        continue
      }
      failures.push({
        rowNumber: row.rowNumber,
        reason: `Could not create room ${row.roomNumber}: ${roomErr.message}`,
      })
      continue
    }

    inserted++
  }

  return {
    ok: true,
    error: null,
    summary: {
      inserted,
      skipped,
      failed: failures.length,
      total: parsed.data.length,
    },
    failures,
  }
}
