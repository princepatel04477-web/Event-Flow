'use server'

import { revalidatePath } from 'next/cache'

import type { ArrivalLeg } from '@/lib/arrivals/banner'
import { friendlyDbError } from '@/lib/errors'
import { createClient } from '@/lib/supabase/server'

/**
 * Arrival data and the arrival-notification switch (A9).
 *
 * `readArrivalLegs` feeds the in-app banner: today's arrival legs, flattened
 * with the family head name and the family's room number so the banner can say
 * "Sharma family arrived · Room 705".
 *
 * Reads run as the signed-in user under normal RLS. The settings table is not
 * in `database.types.ts` (generated), so those calls narrow the client to the
 * exact shape they use; the leg read uses the same cast because Supabase's
 * typed nesting for `guest_groups!inner` and `rooms(...)` is narrower than the
 * query it needs.
 */

type DbError = { code?: string | null; message?: string | null } | null

type ArrivalReadClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        eq: (column: string, value: string) => Promise<{ data: Array<Record<string, unknown>> | null }>
        is: (column: string, value: null) => Promise<{ data: Array<Record<string, unknown>> | null }>
      }
    }
  }
}

export async function readArrivalLegs(eventId: string, date: string): Promise<ArrivalLeg[]> {
  const supabase = await createClient()
  const db = supabase as unknown as ArrivalReadClient

  const [legsResult, roomsResult] = await Promise.all([
    db
      .from('travel_legs')
      .select('id, group_id, travel_date, travel_time, arrived_at, guest_groups!inner(head_name)')
      .eq('event_id', eventId)
      .eq('direction', 'arrival'),
    db
      .from('room_assignments')
      .select('group_id, rooms(room_number)')
      .eq('event_id', eventId)
      .is('released_at', null),
  ])

  const roomByGroup = new Map<string, string>()
  for (const row of roomsResult.data ?? []) {
    const groupId = row.group_id as string | undefined
    const rooms = row.rooms as { room_number?: string } | null | undefined
    if (groupId && rooms?.room_number) roomByGroup.set(groupId, rooms.room_number)
  }

  const out: ArrivalLeg[] = []
  for (const row of legsResult.data ?? []) {
    if (row.travel_date !== date) continue
    const groupId = row.group_id as string
    const group = row.guest_groups as { head_name?: string } | null | undefined
    out.push({
      legId: row.id as string,
      groupId,
      headName: group?.head_name?.trim() || 'A family',
      travelDate: (row.travel_date as string | null) ?? null,
      travelTime: (row.travel_time as string | null) ?? null,
      arrivedAt: (row.arrived_at as string | null) ?? null,
      roomNumber: roomByGroup.get(groupId) ?? null,
    })
  }

  return out
}

// ---------------------------------------------------------------------------
// The on/off switch
// ---------------------------------------------------------------------------

type SettingsClient = {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> }
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => { maybeSingle: () => Promise<{ data: unknown }> }
    }
    upsert: (
      values: Record<string, unknown>,
      options?: Record<string, unknown>,
    ) => Promise<{ error: DbError }>
  }
}

/** True unless an admin has switched it off. An unreadable setting stays on. */
export async function isArrivalsNotifyEnabled(eventId: string): Promise<boolean> {
  try {
    const supabase = await createClient()
    const { data } = await (supabase as unknown as SettingsClient)
      .from('event_notification_settings')
      .select('arrivals_enabled')
      .eq('event_id', eventId)
      .maybeSingle()
    const row = data as { arrivals_enabled?: boolean } | null
    return row?.arrivals_enabled ?? true
  } catch {
    return true
  }
}

export type NotifyToggleResult = { ok: true } | { ok: false; error: string }

export async function setArrivalsNotify(
  eventId: string,
  enabled: boolean,
): Promise<NotifyToggleResult> {
  const supabase = await createClient()
  const { error } = await (supabase as unknown as SettingsClient)
    .from('event_notification_settings')
    .upsert(
      { event_id: eventId, arrivals_enabled: enabled, updated_at: new Date().toISOString() },
      { onConflict: 'event_id' },
    )

  if (error) {
    if (error.code === '42501') return { ok: false, error: 'Only an admin can change this.' }
    return { ok: false, error: friendlyDbError(error) }
  }

  revalidatePath('/', 'layout')
  return { ok: true }
}
