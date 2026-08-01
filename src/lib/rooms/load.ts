import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { normalizeRoomNumber } from '@/lib/rooms/parse'
import {
  hasRoomColumn,
  planBackfill,
  type BackfillGuest,
  type BackfillPlan,
  type BackfillSourceRow,
} from '@/lib/rooms/backfill'

/**
 * Loading everything the backfill planner needs, in one place.
 *
 * Both the preview page and the apply action call this. That is deliberate:
 * the plan the user approves and the plan that gets written must be computed
 * from the same reads by the same code, or the confirmation means nothing.
 */

export interface LoadedBackfill {
  plan: BackfillPlan
  /** False when no imported row carries a room column at all. */
  hasRoomData: boolean
  /** normalized room_number -> room id, for the chosen hotel. */
  roomIdByNumber: Map<string, string>
  error: string | null
}

const EMPTY: Omit<LoadedBackfill, 'error'> = {
  plan: {
    families: [],
    unchanged: [],
    roomsToCreate: [],
    problems: [],
    counts: {
      rowsRead: 0,
      familiesToAssign: 0,
      guestsToAssign: 0,
      roomsToCreate: 0,
      unchanged: 0,
      problems: 0,
    },
  },
  hasRoomData: false,
  roomIdByNumber: new Map(),
}

export async function loadBackfillPlan(
  eventId: string,
  hotelId: string,
  defaultCapacity: number,
): Promise<LoadedBackfill> {
  const supabase = await createClient()

  const [rowsRes, guestsRes, groupsRes, roomsRes, assignmentsRes] = await Promise.all([
    supabase
      .from('import_rows')
      .select('row_number, raw, group_id')
      .eq('event_id', eventId)
      .order('row_number', { ascending: true }),
    supabase
      .from('guests')
      .select('id, group_id, full_name, is_head')
      .eq('event_id', eventId),
    supabase.from('guest_groups').select('id, head_name').eq('event_id', eventId),
    supabase.from('rooms').select('id, room_number, capacity').eq('hotel_id', hotelId).eq('event_id', eventId),
    // Active allocations across the WHOLE event, not just this hotel — a guest
    // already in another hotel's room still cannot take a second one.
    supabase
      .from('room_assignments')
      .select('guest_id, rooms(room_number)')
      .eq('event_id', eventId)
      .is('released_at', null),
  ])

  const failure = [rowsRes, guestsRes, groupsRes, roomsRes, assignmentsRes].find((r) => r.error)
  if (failure?.error) {
    return { ...EMPTY, error: failure.error.message }
  }

  const sourceRows: BackfillSourceRow[] = (rowsRes.data ?? []).map((r) => ({
    rowNumber: r.row_number,
    groupId: r.group_id,
    raw: (r.raw ?? {}) as Record<string, unknown>,
  }))

  const guestsByGroup = new Map<string, BackfillGuest[]>()
  for (const g of guestsRes.data ?? []) {
    const list = guestsByGroup.get(g.group_id) ?? []
    list.push({ id: g.id, fullName: g.full_name, isHead: g.is_head })
    guestsByGroup.set(g.group_id, list)
  }
  // Head first, then alphabetical — a stable order, so the same run twice
  // fills rooms in the same sequence.
  for (const list of guestsByGroup.values()) {
    list.sort(
      (a, b) => Number(b.isHead) - Number(a.isHead) || a.fullName.localeCompare(b.fullName),
    )
  }

  const groupNames = new Map((groupsRes.data ?? []).map((g) => [g.id, g.head_name]))

  const existingRooms = new Map<string, { id: string; capacity: number }>()
  const roomIdByNumber = new Map<string, string>()
  for (const r of roomsRes.data ?? []) {
    const key = normalizeRoomNumber(r.room_number)
    existingRooms.set(key, { id: r.id, capacity: r.capacity })
    roomIdByNumber.set(key, r.id)
  }

  type AssignmentJoin = { guest_id: string; rooms: { room_number: string } | null }
  const activeRoomByGuest = new Map<string, string>()
  for (const a of (assignmentsRes.data ?? []) as unknown as AssignmentJoin[]) {
    if (a.rooms?.room_number) {
      activeRoomByGuest.set(a.guest_id, normalizeRoomNumber(a.rooms.room_number))
    }
  }

  const plan = planBackfill(sourceRows, {
    guestsByGroup,
    groupNames,
    existingRooms,
    activeRoomByGuest,
    defaultCapacity,
  })

  return {
    plan,
    hasRoomData: hasRoomColumn(sourceRows),
    roomIdByNumber,
    error: null,
  }
}
