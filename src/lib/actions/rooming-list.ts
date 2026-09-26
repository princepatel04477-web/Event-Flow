'use server'

/**
 * The rooming list: one read, one row per room × family, for the sheet the
 * hotel and the front desk work from.
 *
 * WHY NOT `readRoomsGrid`. That read exists and is close, and reusing it was the
 * first plan. Three things it deliberately does not carry, each of which is a
 * column on this screen:
 *
 *   - `rooms.room_type` is not selected (the board has no Type column).
 *   - `room_assignments.checked_in_at` / `checked_out_at` are not selected (the
 *     board is about beds, not arrivals).
 *   - it drops the hamper DELIVERABLE ID, keeping only a `hamperDelivered`
 *     boolean — and the id is what opens the proof photo.
 *
 * Widening `readRoomsGrid` to carry all three would put this screen's needs
 * inside the query the Rooms board runs on every mount, on the one screen that
 * has already been tuned for a 543-guest event. So this is its own read, and it
 * is read-only: nothing in this module writes.
 *
 * Sequential requests, not `Promise.all`, for the same reason
 * `readRoomsGrid` is: the grid was flaky at full scale when five requests fired
 * concurrently at the Seoul region, and sequential keeps each one individually
 * short and deterministic.
 */

import { getEventAccess } from '@/lib/supabase/queries'
import { createClient } from '@/lib/supabase/server'
import { type RoomingCheckIn, type RoomingHamper, type RoomingListRow } from '@/lib/rooms/rooming-list'

export interface RoomingListResult {
  ok: boolean
  error: string | null
  rows: RoomingListRow[]
}

export async function readRoomingList(eventId: string): Promise<RoomingListResult> {
  const access = await getEventAccess(eventId)
  // A client login reads nothing here. `guest_groups` returns zero rows for
  // them under RLS anyway, so without this the screen would render an empty
  // table rather than saying no.
  if (access !== 'admin' && access !== 'event_team') {
    return { ok: false, error: 'Not permitted.', rows: [] }
  }

  const supabase = await createClient()

  const roomsRes = await supabase
    .from('rooms')
    .select('id, hotel_id, room_number, room_type, floor, is_blocked')
    .eq('event_id', eventId)
  if (roomsRes.error) {
    return { ok: false, error: 'Could not read the rooms. Check your connection.', rows: [] }
  }

  const hotelsRes = await supabase.from('hotels').select('id, name').eq('event_id', eventId)

  // Active stays only. A released assignment is history: the room it named is
  // free, and putting it on the sheet would show the hotel a guest who has
  // been moved elsewhere.
  const assignmentsRes = await supabase
    .from('room_assignments')
    .select('id, room_id, guest_id, group_id, checked_in_at, checked_out_at')
    .eq('event_id', eventId)
    .is('released_at', null)
  if (assignmentsRes.error) {
    return { ok: false, error: 'Could not read who is in which room.', rows: [] }
  }

  const groupsRes = await supabase
    .from('guest_groups')
    .select('id, head_name')
    .eq('event_id', eventId)

  const guestsRes = await supabase
    .from('guests')
    .select('id, group_id, full_name, is_head')
    .eq('event_id', eventId)

  // Group-level hampers: `kind = hamper`, `guest_id is null` — the house model
  // is one hamper per family, and the partial unique index
  // `deliverables_one_per_group_kind` only constrains that shape (CLAUDE.md
  // §10). The id comes back because it is what the proof screen is keyed on.
  const hampersRes = await supabase
    .from('deliverables')
    .select('id, group_id, status')
    .eq('event_id', eventId)
    .eq('kind', 'hamper')
    .is('guest_id', null)

  const hotelNames = new Map((hotelsRes.data ?? []).map((h) => [h.id, h.name]))
  const headNames = new Map((groupsRes.data ?? []).map((g) => [g.id, g.head_name]))
  const guestById = new Map((guestsRes.data ?? []).map((g) => [g.id, g]))

  const hamperByGroup = new Map<string, { id: string; status: string }>()
  for (const d of hampersRes.data ?? []) {
    hamperByGroup.set(d.group_id, { id: d.id, status: d.status as string })
  }

  /**
   * A guest's name on the sheet.
   *
   * The head's own `guests.full_name` and the group's `head_name` are two
   * columns holding the same person, and the import writes the group's version
   * first — so the group's name wins for a head and the member row's name is
   * used for everybody else. Getting this backwards puts "Guest" on the line
   * the hotel reads.
   */
  const guestName = (guestId: string): string => {
    const guest = guestById.get(guestId)
    if (!guest) return 'Guest'
    if (guest.is_head) {
      const head = headNames.get(guest.group_id)?.trim()
      if (head) return head
    }
    return guest.full_name?.trim() || 'Guest'
  }

  // room id → group id → the beds that family holds in that room.
  const byRoomGroup = new Map<
    string,
    Map<string, { guestIds: string[]; checkedInAt: string | null; checkedOutAt: string | null }>
  >()
  for (const a of assignmentsRes.data ?? []) {
    let groups = byRoomGroup.get(a.room_id)
    if (!groups) {
      groups = new Map()
      byRoomGroup.set(a.room_id, groups)
    }
    const entry = groups.get(a.group_id) ?? {
      guestIds: [],
      checkedInAt: null,
      checkedOutAt: null,
    }
    entry.guestIds.push(a.guest_id)
    // A family's beds in one room are checked in together by `check_in_room`,
    // which stamps every assignment for the group. Taking the FIRST non-null is
    // therefore the family's time, and it stays correct if a future flow ever
    // stamps them one at a time — the row then reads "In" from the moment the
    // first person arrives, which is what a front desk means by it.
    entry.checkedInAt ??= a.checked_in_at
    entry.checkedOutAt ??= a.checked_out_at
    groups.set(a.group_id, entry)
  }

  const rows: RoomingListRow[] = []
  for (const room of roomsRes.data ?? []) {
    const base = {
      roomId: room.id,
      hotelId: room.hotel_id,
      hotelName: hotelNames.get(room.hotel_id) ?? 'Unknown hotel',
      roomNumber: room.room_number,
      roomType: room.room_type,
      floor: room.floor,
      isBlocked: room.is_blocked,
    }

    const groups = byRoomGroup.get(room.id)

    // An empty room is still a line. A rooming list that omits the rooms nobody
    // is in is how a hotel loses track of a room it is holding for you.
    if (!groups || groups.size === 0) {
      rows.push({
        ...base,
        key: `${room.id}:empty`,
        groupId: null,
        headName: null,
        pax: 0,
        guestNames: [],
        checkIn: 'no_family',
        checkedInAt: null,
        checkedOutAt: null,
        hamper: 'none',
        hamperDeliverableId: null,
      })
      continue
    }

    for (const [groupId, entry] of groups) {
      const hamper = hamperByGroup.get(groupId)
      const hamperState: RoomingHamper = !hamper
        ? 'none'
        : hamper.status === 'delivered'
          ? 'delivered'
          : 'pending'

      const checkIn: RoomingCheckIn =
        entry.checkedOutAt !== null ? 'out' : entry.checkedInAt !== null ? 'in' : 'not_yet'

      rows.push({
        ...base,
        key: `${room.id}:${groupId}`,
        groupId,
        headName: headNames.get(groupId) ?? null,
        pax: entry.guestIds.length,
        guestNames: entry.guestIds.map(guestName),
        checkIn,
        checkedInAt: entry.checkedInAt,
        checkedOutAt: entry.checkedOutAt,
        hamper: hamperState,
        hamperDeliverableId: hamper?.id ?? null,
      })
    }
  }

  return { ok: true, error: null, rows }
}
