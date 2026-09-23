/**
 * The fixtures the flow specs need that `e2e/v12-seed.mjs` does not create.
 *
 * `v12-seed.mjs` already owns: the head of the calling queue, a family waiting
 * for a room, a hamper with a room and an undelivered `deliverables` row, an
 * arrival leg landing today, and the client's own room. What it does not have
 * is a SINGLE — the brief's Phase 2 explicitly calls for two single guests who
 * decide to share a room, and "share with another single" is one of the jobs
 * this directory has to drive end to end.
 *
 * ── THE CONTRACT THIS FILE KEEPS ───────────────────────────────────────────
 *
 * It owns one set of rows, every one of them named `FLOW-…`, and it deletes
 * only rows carrying that prefix. It never touches the 543-guest scale fixture,
 * the V12 fixtures, or anything a previous session wrote. `resetFlowFixtures()`
 * is idempotent: running it twice leaves one set of rows, not two.
 *
 * The fixture is RESET before each room test rather than seeded once, because
 * the auto-fill job COMMITS real room assignments for the same families the
 * move/share jobs act on — run in one order the share list is empty, run in
 * another it is not. Resetting between jobs makes the order irrelevant, which
 * is the only way a spec can assert a tap budget about a screen rather than
 * about its predecessor.
 *
 * THE DATABASE IS THE ORACLE, NOT THE SUBJECT: every row here is written with
 * the service role and the app is driven through a real session. Nothing in
 * this file clicks anything.
 */

import { db } from '../v12-seed.mjs'

/** Every row this module owns carries this prefix. Nothing else is deleted. */
export const FLOW_PREFIX = 'FLOW-'

export const FLOW_FAMILIES = {
  /** Job (b): the single who already holds a bed in `FLOW-801`. */
  singleA: `${FLOW_PREFIX}Single A`,
  /** Job (b): the single with no bed, waiting, on the same side. */
  singleB: `${FLOW_PREFIX}Single B`,
  /** Job (c): a family with a bed who has not arrived. */
  checkin: `${FLOW_PREFIX}Checkin Family`,
  /** Job (e): a family at the desk saying they are leaving, with no departure leg. */
  walkup: `${FLOW_PREFIX}Walkup Family`,
} as const

export const FLOW_ROOMS = {
  /** One single in a two-bed room: `Share with another single` is offered here. */
  share: `${FLOW_PREFIX}801`,
  /** The check-in family's room. */
  checkin: `${FLOW_PREFIX}802`,
  /** Empty, and the destination of the "move a guest" job. */
  moveTo: `${FLOW_PREFIX}803`,
} as const

export interface FlowFixtures {
  eventId: string
  shareRoomId: string
  moveToRoomId: string
  singleAGroupId: string
  singleBGroupId: string
  checkinGroupId: string
  walkupGroupId: string
}

interface GroupSpec {
  name: string
  headcount: number
  mobile: string
  groupType: string
  side: string
}

const GROUPS: GroupSpec[] = [
  { name: FLOW_FAMILIES.singleA, headcount: 1, mobile: '9811100101', groupType: 'single', side: 'bride' },
  { name: FLOW_FAMILIES.singleB, headcount: 1, mobile: '9811100102', groupType: 'single', side: 'bride' },
  { name: FLOW_FAMILIES.checkin, headcount: 2, mobile: '9811100103', groupType: 'family', side: 'groom' },
  { name: FLOW_FAMILIES.walkup, headcount: 2, mobile: '9811100104', groupType: 'family', side: 'groom' },
]

/** Create a confirmed family with one named head guest. Returns the ids. */
async function createFamily(
  eventId: string,
  spec: GroupSpec,
): Promise<{ groupId: string; guestId: string }> {
  const { data: group, error } = await db
    .from('guest_groups')
    .insert({
      event_id: eventId,
      head_name: spec.name,
      primary_mobile: spec.mobile,
      expected_pax: spec.headcount,
      confirmed_pax: spec.headcount,
      adults_confirmed: spec.headcount,
      children_confirmed: 0,
      rsvp_status: 'confirmed',
      side: spec.side,
      group_type: spec.groupType,
    })
    .select('id')
    .single()
  if (error || !group) throw new Error(`flow seed family ${spec.name}: ${error?.message}`)

  const { data: guest, error: guestErr } = await db
    .from('guests')
    .insert({ event_id: eventId, group_id: group.id, full_name: spec.name, is_head: true })
    .select('id')
    .single()
  if (guestErr || !guest) throw new Error(`flow seed head guest ${spec.name}: ${guestErr?.message}`)

  return { groupId: group.id, guestId: guest.id }
}

/**
 * Delete every row this module owns, in the order the foreign keys force.
 *
 * `room_assignments` first — by OUR groups AND by OUR rooms, because the
 * auto-fill job is free to place a V12 family into a `FLOW-` room, and an
 * assignment left pointing at a deleted room is an error the delete silently
 * swallows and the next insert then trips over.
 */
export async function unseedFlowFixtures(): Promise<void> {
  const { data: groups } = await db
    .from('guest_groups')
    .select('id')
    .in('head_name', GROUPS.map((g) => g.name))
  const groupIds = (groups ?? []).map((g) => g.id)

  const { data: rooms } = await db
    .from('rooms')
    .select('id')
    .ilike('room_number', `${FLOW_PREFIX}%`)
  const roomIds = (rooms ?? []).map((r) => r.id)

  if (groupIds.length > 0) {
    await db.from('room_assignments').delete().in('group_id', groupIds)
  }
  if (roomIds.length > 0) {
    await db.from('room_assignments').delete().in('room_id', roomIds)
    await db.from('deliverables').delete().in('room_id', roomIds)
    await db.from('rooms').delete().in('id', roomIds)
  }
  if (groupIds.length > 0) {
    await db.from('travel_legs').delete().in('group_id', groupIds)
    await db.from('guests').delete().in('group_id', groupIds)
    await db.from('guest_groups').delete().in('id', groupIds)
  }
}

/**
 * Wipe and recreate the flow fixtures. Idempotent.
 *
 * The rooms are created with `capacity` = `max_capacity` = 2 and no
 * `is_blocked`, so the "share with another single" offer has exactly one free
 * bed to offer and the capacity guard cannot fire on a two-person room.
 */
export async function seedFlowFixtures(eventId: string): Promise<FlowFixtures> {
  await unseedFlowFixtures()

  const { data: hotel } = await db
    .from('hotels')
    .select('id, name')
    .eq('event_id', eventId)
    .limit(1)
    .maybeSingle()

  const { data: rooms, error: roomErr } = await db
    .from('rooms')
    .insert([
      {
        event_id: eventId,
        hotel_id: hotel?.id ?? null,
        room_number: FLOW_ROOMS.share,
        capacity: 2,
        max_capacity: 2,
        floor: '8',
      },
      {
        event_id: eventId,
        hotel_id: hotel?.id ?? null,
        room_number: FLOW_ROOMS.checkin,
        capacity: 2,
        max_capacity: 2,
        floor: '8',
      },
      {
        event_id: eventId,
        hotel_id: hotel?.id ?? null,
        room_number: FLOW_ROOMS.moveTo,
        capacity: 2,
        max_capacity: 2,
        floor: '8',
      },
    ])
    .select('id, room_number')
  if (roomErr || !rooms) throw new Error(`flow seed rooms: ${roomErr?.message}`)

  const roomId = (number: string): string => {
    const room = rooms.find((r) => r.room_number === number)
    if (!room) throw new Error(`flow seed: room ${number} was not created`)
    return room.id
  }

  const byName = new Map<string, { groupId: string; guestId: string }>()
  for (const spec of GROUPS) {
    byName.set(spec.name, await createFamily(eventId, spec))
  }

  const singleA = byName.get(FLOW_FAMILIES.singleA)!
  const checkin = byName.get(FLOW_FAMILIES.checkin)!

  // One single in a two-bed room. This is the state the brief's "if two single
  // people decide to share a room, that pairing must be updateable" is about.
  const { error: assignErr } = await db.from('room_assignments').insert([
    {
      event_id: eventId,
      room_id: roomId(FLOW_ROOMS.share),
      guest_id: singleA.guestId,
      group_id: singleA.groupId,
      is_override: false,
    },
    {
      event_id: eventId,
      room_id: roomId(FLOW_ROOMS.checkin),
      guest_id: checkin.guestId,
      group_id: checkin.groupId,
      is_override: false,
    },
  ])
  if (assignErr) throw new Error(`flow seed room assignments: ${assignErr.message}`)

  return {
    eventId,
    shareRoomId: roomId(FLOW_ROOMS.share),
    moveToRoomId: roomId(FLOW_ROOMS.moveTo),
    singleAGroupId: singleA.groupId,
    singleBGroupId: byName.get(FLOW_FAMILIES.singleB)!.groupId,
    checkinGroupId: checkin.groupId,
    walkupGroupId: byName.get(FLOW_FAMILIES.walkup)!.groupId,
  }
}
