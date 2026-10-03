'use server'

/**
 * Deliverables — hamper / return-gift generation and the delivery-run list.
 *
 * Nothing in the app created `deliverables` rows; the proof chain therefore
 * had nothing to attach a photo to. This module is the admin side:
 *
 * - `generateDeliverables()` creates one hamper per group that has an active
 *   room assignment, and one return gift per group with needs_return_gift,
 *   matching on the existing partial unique index (group_id, kind) so a
 *   re-run never duplicates. Idempotent by construction.
 * - `readDeliveryRun()` lists pending deliverables joined to the room/hotel,
 *   so a staff member can walk a floor in order.
 *
 * Deliverable status is NEVER written here and never written by the client:
 * only the delivery_proofs insert trigger flips a deliverable to delivered
 * (migration 0300). That is the whole point of the proof chain.
 */

import { getEventAccess } from '@/lib/supabase/queries'
import { createClient } from '@/lib/supabase/server'

/** Per-phase timing for server actions (instrument-first). */
function phaseTiming(label: string) {
  const marks: Record<string, number> = {}
  let last = performance.now()
  return {
    mark(name: string) {
      const now = performance.now()
      marks[name] = Math.round(now - last)
      last = now
    },
    report() {
      const parts = Object.entries(marks).map(([k, v]) => `${k}:${v}ms`)
      console.log(`[perf] ${label} phases :: ${parts.join(' · ')}`)
    },
  }
}

export interface GenerateResult {
  ok: boolean
  error: string | null
  summary: {
    hampersCreated: number
    returnGiftsCreated: number
    existingHampers: number
    existingReturnGifts: number
  }
}

/**
 * Create the deliverable rows for this event, idempotently.
 *
 * A hamper is created for every group that has an active room assignment (a
 * family without a room is not yet in a deliverable position — flag it
 * rather than guessing). A return gift is created for every group with
 * needs_return_gift = true. The partial unique index
 * (group_id, kind) WHERE guest_id IS NULL makes a re-run a no-op.
 */
export async function generateDeliverables(eventId: string): Promise<GenerateResult> {
  const access = await getEventAccess(eventId)
  if (access !== 'admin' && access !== 'event_team') {
    return { ok: false, error: 'Not permitted. Only staff can manage deliveries.', summary: { hampersCreated: 0, returnGiftsCreated: 0, existingHampers: 0, existingReturnGifts: 0 } }
  }

  const supabase = await createClient()

  // Groups with an active (unreleased) room assignment.
  const { data: hampers, error: hamperErr } = await supabase
    .from('room_assignments')
    .select('event_id, group_id, room_id')
    .eq('event_id', eventId)
    .is('released_at', null)
  if (hamperErr) {
    return { ok: false, error: `Could not read room assignments: ${hamperErr.message}`, summary: { hampersCreated: 0, returnGiftsCreated: 0, existingHampers: 0, existingReturnGifts: 0 } }
  }

  // Distinct group_ids that need a return gift.
  const { data: giftGroups, error: giftErr } = await supabase
    .from('guest_groups')
    .select('id')
    .eq('event_id', eventId)
    .eq('needs_return_gift', true)
  if (giftErr) {
    return { ok: false, error: `Could not read guest groups: ${giftErr.message}`, summary: { hampersCreated: 0, returnGiftsCreated: 0, existingHampers: 0, existingReturnGifts: 0 } }
  }

  // What already exists, so the summary is honest about what was added vs
  // already there.
  const { data: existing, error: existingErr } = await supabase
    .from('deliverables')
    .select('kind, group_id, room_id')
    .eq('event_id', eventId)
  if (existingErr) {
    return { ok: false, error: `Could not read existing deliverables: ${existingErr.message}`, summary: { hampersCreated: 0, returnGiftsCreated: 0, existingHampers: 0, existingReturnGifts: 0 } }
  }

  // Hampers are ROOM-targeted (F8a, client answer "one hamper per room"), so
  // they dedupe on room_id; return gifts stay group-targeted.
  const seenRooms = new Set(
    existing.filter((d) => d.room_id).map((d) => `${d.room_id}:${d.kind}`),
  )
  const seenGroups = new Set(
    existing.filter((d) => d.group_id).map((d) => `${d.group_id}:${d.kind}`),
  )
  const existingHampers = existing.filter((d) => d.kind === 'hamper').length
  const existingReturnGifts = existing.filter((d) => d.kind === 'return_gift').length

  let hampersCreated = 0
  let returnGiftsCreated = 0

  // Distinct ROOMS (not families) with an active assignment — one hamper each.
  const roomIds = [...new Set((hampers ?? []).map((h) => h.room_id).filter((id): id is string => id !== null))]
  const hamperRows = roomIds
    .filter((roomId) => !seenRooms.has(`${roomId}:hamper`))
    .map((roomId) => ({
      event_id: eventId,
      room_id: roomId,
      kind: 'hamper' as const,
      quantity: 1,
      item_name: 'Welcome hamper',
    }))
  if (hamperRows.length > 0) {
    const { error } = await supabase.from('deliverables').insert(hamperRows)
    if (error) {
      return { ok: false, error: `Could not create hampers: ${error.message}`, summary: { hampersCreated: 0, returnGiftsCreated: 0, existingHampers, existingReturnGifts } }
    }
    hampersCreated = hamperRows.length
  }

  const giftRows = (giftGroups ?? [])
    .map((g) => ({
      event_id: eventId,
      group_id: g.id,
      kind: 'return_gift' as const,
      quantity: 1,
      item_name: 'Return gift',
    }))
    .filter((r) => !seenGroups.has(`${r.group_id}:${r.kind}`))
  if (giftRows.length > 0) {
    const { error } = await supabase.from('deliverables').insert(giftRows)
    if (error) {
      return { ok: false, error: `Could not create return gifts: ${error.message}`, summary: { hampersCreated, returnGiftsCreated: 0, existingHampers: existingHampers + hampersCreated, existingReturnGifts } }
    }
    returnGiftsCreated = giftRows.length
  }

  return {
    ok: true,
    error: null,
    summary: {
      hampersCreated,
      returnGiftsCreated,
      existingHampers,
      existingReturnGifts,
    },
  }
}

export interface DeliveryRunRow {
  id: string
  kind: 'hamper' | 'return_gift'
  status: string
  /** null on a room-targeted hamper (F8a — the target is the room, not a family). */
  group_id: string | null
  head_name: string | null
  primary_mobile: string | null
  hotel_name: string | null
  room_number: string | null
  floor: string | null
  item_name: string | null
  quantity: number
  assigned_to: string | null
}

export interface DeliveryRunResult {
  ok: boolean
  error: string | null
  rows: DeliveryRunRow[]
}

/**
 * The delivery run: pending deliverables joined to their room + hotel, so a
 * staff member can walk a floor in order. Includes delivered ones so the
 * screen can show delivered/pending counts per hotel. Deliberately returns
 * the group's head name + mobile — the caller needs to confirm the door.
 */
export async function readDeliveryRun(eventId: string): Promise<DeliveryRunResult> {
  const timing = phaseTiming('deliveries :: readDeliveryRun')
  const access = await getEventAccess(eventId)
  timing.mark('guard')
  if (access !== 'admin' && access !== 'event_team') {
    return { ok: false, error: 'Not permitted.', rows: [] }
  }

  const supabase = await createClient()
  timing.mark('client-create')

  const { data, error } = await supabase
    .from('deliverables')
    .select(
      `id, kind, status, group_id, quantity, item_name, assigned_to,
       room_id,
       guest_groups ( head_name, primary_mobile ),
       rooms ( room_number, floor, hotels ( name ) )`,
    )
    .eq('event_id', eventId)
    .order('room_id', { ascending: true })
  timing.mark('request')

  if (error) {
    return { ok: false, error: `Could not read the delivery run: ${error.message}`, rows: [] }
  }

  const rows: DeliveryRunRow[] = (data ?? []).map((d) => ({
    id: d.id,
    kind: d.kind as 'hamper' | 'return_gift',
    status: d.status as string,
    group_id: d.group_id,
    head_name: (d.guest_groups as unknown as { head_name: string | null } | null)?.head_name ?? null,
    primary_mobile: (d.guest_groups as unknown as { primary_mobile: string | null } | null)?.primary_mobile ?? null,
    hotel_name: ((d.rooms as unknown as { hotels: { name: string } | null } | null)?.hotels?.name) ?? null,
    room_number: (d.rooms as unknown as { room_number: string | null } | null)?.room_number ?? null,
    floor: (d.rooms as unknown as { floor: string | null } | null)?.floor ?? null,
    item_name: d.item_name,
    quantity: d.quantity,
    assigned_to: d.assigned_to,
  }))
  timing.mark('parse')
  timing.report()

  return { ok: true, error: null, rows }
}

// ---------------------------------------------------------------------------
// F8b — hampers by ROOM. One hamper per room (the client's answer); a family
// split across rooms gets one in each. The room is the target, so a hamper no
// longer needs a family.
// ---------------------------------------------------------------------------

export interface HamperRoomRow {
  roomId: string
  hotelId: string
  hotelName: string | null
  floor: string | null
  roomNumber: string
  /** Head names of the families with a guest in this room. */
  families: string[]
  /** Guests currently placed in this room. */
  guests: number
  /** The room's hamper, when one exists. */
  hamper: { id: string; status: string; quantity: number } | null
}

export type HamperRoomsResult =
  | { ok: true; rows: HamperRoomRow[] }
  | { ok: false; error: string }

export async function readHamperRooms(eventId: string): Promise<HamperRoomsResult> {
  const access = await getEventAccess(eventId)
  if (access !== 'admin' && access !== 'event_team') {
    return { ok: false, error: 'Not permitted.' }
  }

  const supabase = await createClient()
  const [roomsRes, assignsRes, groupsRes, hampersRes] = await Promise.all([
    supabase
      .from('rooms')
      .select('id, room_number, floor, hotel_id, hotels ( name )')
      .eq('event_id', eventId),
    supabase
      .from('room_assignments')
      .select('room_id, group_id')
      .eq('event_id', eventId)
      .is('released_at', null),
    supabase.from('guest_groups').select('id, head_name').eq('event_id', eventId),
    supabase
      .from('deliverables')
      .select('id, room_id, status, quantity')
      .eq('event_id', eventId)
      .eq('kind', 'hamper')
      .not('room_id', 'is', null),
  ])
  const failure = [roomsRes, assignsRes, groupsRes, hampersRes].find((r) => r.error)
  if (failure?.error) {
    return { ok: false, error: `Could not read the hamper rooms: ${failure.error.message}` }
  }

  const headByGroup = new Map((groupsRes.data ?? []).map((g) => [g.id, g.head_name]))
  const familiesByRoom = new Map<string, Set<string>>()
  const guestsByRoom = new Map<string, number>()
  for (const a of assignsRes.data ?? []) {
    if (!a.room_id) continue
    guestsByRoom.set(a.room_id, (guestsByRoom.get(a.room_id) ?? 0) + 1)
    const head = a.group_id ? headByGroup.get(a.group_id) : null
    if (head) {
      const set = familiesByRoom.get(a.room_id) ?? new Set<string>()
      set.add(head)
      familiesByRoom.set(a.room_id, set)
    }
  }

  const hamperByRoom = new Map<string, { id: string; status: string; quantity: number }>()
  for (const d of hampersRes.data ?? []) {
    if (d.room_id) hamperByRoom.set(d.room_id, { id: d.id, status: d.status as string, quantity: d.quantity })
  }

  const rows: HamperRoomRow[] = (roomsRes.data ?? []).map((r) => ({
    roomId: r.id,
    hotelId: r.hotel_id,
    hotelName: ((r.hotels as unknown as { name: string } | null)?.name) ?? null,
    floor: r.floor,
    roomNumber: r.room_number,
    families: [...(familiesByRoom.get(r.id) ?? [])],
    guests: guestsByRoom.get(r.id) ?? 0,
    hamper: hamperByRoom.get(r.id) ?? null,
  }))

  return { ok: true, rows }
}

export interface AssignHampersResult {
  ok: boolean
  created: number
  alreadyThere: number
  error: string | null
}

/**
 * Assign one hamper to each of these rooms. Idempotent: a room that already has
 * a hamper of this kind is skipped, and the `(room_id, kind)` unique index is
 * the backstop. Quantity is stored (the rule is one per room), never computed.
 */
export async function assignHampersToRooms(
  eventId: string,
  roomIds: readonly string[],
  quantity = 1,
): Promise<AssignHampersResult> {
  const access = await getEventAccess(eventId)
  if (access !== 'admin' && access !== 'event_team') {
    return { ok: false, created: 0, alreadyThere: 0, error: 'Not permitted.' }
  }
  if (roomIds.length === 0) return { ok: true, created: 0, alreadyThere: 0, error: null }

  const supabase = await createClient()
  const { data: existing, error: readErr } = await supabase
    .from('deliverables')
    .select('room_id')
    .eq('event_id', eventId)
    .eq('kind', 'hamper')
    .in('room_id', roomIds as string[])
  if (readErr) {
    return { ok: false, created: 0, alreadyThere: 0, error: `Could not read the rooms: ${readErr.message}` }
  }

  const has = new Set((existing ?? []).map((d) => d.room_id))
  const toCreate = roomIds.filter((id) => !has.has(id))
  if (toCreate.length === 0) {
    return { ok: true, created: 0, alreadyThere: roomIds.length, error: null }
  }

  const { error: insertErr } = await supabase.from('deliverables').insert(
    toCreate.map((roomId) => ({
      event_id: eventId,
      room_id: roomId,
      kind: 'hamper' as const,
      quantity,
      item_name: 'Welcome hamper',
    })),
  )
  if (insertErr) {
    return { ok: false, created: 0, alreadyThere: roomIds.length - toCreate.length, error: `Could not assign the hampers: ${insertErr.message}` }
  }

  return { ok: true, created: toCreate.length, alreadyThere: roomIds.length - toCreate.length, error: null }
}

/**
 * Undo an assignment: delete the PENDING room hampers for these rooms. A
 * delivered hamper (it has a proof) is never deleted — the `(room_id, kind)`
 * row stays and the caller re-reads.
 */
export async function unassignHampersFromRooms(
  eventId: string,
  roomIds: readonly string[],
): Promise<{ ok: boolean; removed: number; error: string | null }> {
  const access = await getEventAccess(eventId)
  if (access !== 'admin' && access !== 'event_team') {
    return { ok: false, removed: 0, error: 'Not permitted.' }
  }
  if (roomIds.length === 0) return { ok: true, removed: 0, error: null }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('deliverables')
    .delete()
    .eq('event_id', eventId)
    .eq('kind', 'hamper')
    .in('room_id', roomIds as string[])
    .eq('status', 'pending')
    .select('id')
  if (error) return { ok: false, removed: 0, error: `Could not undo: ${error.message}` }
  return { ok: true, removed: (data ?? []).length, error: null }
}
