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
import { supabase } from '@/lib/supabase/client'

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
    .select('kind, group_id')
    .eq('event_id', eventId)
  if (existingErr) {
    return { ok: false, error: `Could not read existing deliverables: ${existingErr.message}`, summary: { hampersCreated: 0, returnGiftsCreated: 0, existingHampers: 0, existingReturnGifts: 0 } }
  }

  const seen = new Set(existing.map((d) => `${d.group_id}:${d.kind}`))
  let hampersCreated = 0
  let returnGiftsCreated = 0

  const hamperRows = (hampers ?? [])
    .filter((h) => h.group_id)
    .map((h) => ({
      event_id: eventId,
      group_id: h.group_id,
      room_id: h.room_id,
      kind: 'hamper' as const,
      quantity: 1,
      item_name: 'Welcome hamper',
    }))
    .filter((r) => !seen.has(`${r.group_id}:${r.kind}`))
  if (hamperRows.length > 0) {
    const { error } = await supabase.from('deliverables').insert(hamperRows)
    if (error) {
      return { ok: false, error: `Could not create hampers: ${error.message}`, summary: { hampersCreated: 0, returnGiftsCreated: 0, existingHampers: seenHampers(seen), existingReturnGifts: seenGifts(seen) } }
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
    .filter((r) => !seen.has(`${r.group_id}:${r.kind}`))
  if (giftRows.length > 0) {
    const { error } = await supabase.from('deliverables').insert(giftRows)
    if (error) {
      return { ok: false, error: `Could not create return gifts: ${error.message}`, summary: { hampersCreated, returnGiftsCreated: 0, existingHampers: seenHampers(seen) + hampersCreated, existingReturnGifts: seenGifts(seen) } }
    }
    returnGiftsCreated = giftRows.length
  }

  return {
    ok: true,
    error: null,
    summary: {
      hampersCreated,
      returnGiftsCreated,
      existingHampers: seenHampers(seen),
      existingReturnGifts: seenGifts(seen),
    },
  }
}

function seenHampers(seen: Set<string>): number {
  return [...seen].filter((k) => k.endsWith(':hamper')).length
}
function seenGifts(seen: Set<string>): number {
  return [...seen].filter((k) => k.endsWith(':return_gift')).length
}

export interface DeliveryRunRow {
  id: string
  kind: 'hamper' | 'return_gift'
  status: string
  group_id: string
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
