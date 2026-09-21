/**
 * V12 seed — the fixtures the nine tap-budget tasks are measured against.
 *
 * READ-ONLY ON EVERYTHING IT DID NOT CREATE. This module owns one small set of
 * rows, all named with the `V12-` prefix, and it deletes only rows carrying that
 * prefix before re-creating them. It never touches the 543-guest scale fixture,
 * the real event data, or anything a previous session wrote.
 *
 * WHY THIS EXISTS AT ALL. Measured against the standing event, five of the nine
 * tasks have nothing to act on:
 *
 *   - `SAMPLE2026` (the event the team and client access codes actually sign
 *     into — see DECISIONS.md, V12) has 782 families, 14 rooms and 9 arrival
 *     legs, but `deliverables` is empty, so "mark a hamper delivered" has no
 *     hamper to open.
 *   - The queue's head is `SEED-543 ...` and the seeded proof families, so
 *     "call the next family" dials a name nobody can predict and logs a call
 *     row that is then frozen forever (`app.guard_call_attempt`).
 *   - No family is called "Sharma", so "find the family Sharma" cannot be met on
 *     purpose.
 *
 * A budget measured on an empty screen is not a budget. So the tasks are
 * measured against rows created for them, and the spec asserts the seeded state
 * exists before it starts — otherwise a passing tap count would mean the screen
 * was empty rather than fast.
 *
 * THE DATABASE IS THE ORACLE, NOT THE SUBJECT (the rule from T1's audit): the
 * rows here are created with the service role, and the APP is exercised through
 * a real session. Nothing in this file clicks anything.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createClient } from '@supabase/supabase-js'

/** Every row this module owns carries this prefix. Nothing else is deleted. */
export const V12_PREFIX = 'V12-'

/** The names the tasks target. Exported so the spec and the runner agree. */
export const FAMILIES = {
  /** Job 3: "find the family Sharma" (<= 3 taps). */
  search: `${V12_PREFIX}Sharma Family`,
  /**
   * Job 1 & 2: call the next family, log the outcome.
   *
   * THE NAME IS THE MECHANISM, NOT A LABEL. `CallNext` shows the head of
   * `v_rsvp_queue` ordered `attempt_count asc, last_attempt_at asc nulls first,
   * priority desc, head_name asc` — so with 700-odd families all on zero
   * attempts, the card is whoever sorts first by NAME. A family called
   * `V12-Aarav Shah` never won that race against `E2E-PROOF-…` and `SEED-543 …`,
   * and the runner's first measurement was a family with no phone number on file
   * and a dial button that could not be pressed. The `0 ` prefix sorts before
   * every existing head name in this event, so the head of the queue is a family
   * this suite created and can therefore assert about.
   */
  call: `0 ${V12_PREFIX}Call Next`,
  /** Job 4 & 6: give a family a room, then undo it. */
  room: `${V12_PREFIX}Diya Mehta`,
  /** Job 5: mark a hamper delivered with a photo. */
  hamper: `${V12_PREFIX}Kabir Rao`,
  /** Job 7: mark an arrival arrived. */
  arrival: `${V12_PREFIX}Neha Iyer`,
  /** Job 8: the client's own room (a family with one active assignment). */
  clientRoom: `${V12_PREFIX}Rohan Gupta`,
  /** Job 9: a family landing today. */
  clientArrival: `${V12_PREFIX}Ananya Nair`,
}

export const ROOM_NUMBER = 'V12-701'

/**
 * `.env.test` + `.env.local`, read here rather than through
 * `e2e/helpers/env.ts`.
 *
 * That module is TypeScript and validates a REQUIRED list that includes
 * `E2E_EVENT_ID` — the event this seed deliberately does not use. Duplicating
 * twenty lines of parser is a smaller lie than importing a validator whose
 * central claim (that `E2E_EVENT_ID` is the test event) is the very thing V12
 * measured to be wrong. The keys this file needs are checked below, by name.
 */
function loadEnv() {
  const out = {}
  for (const file of ['.env.local', '.env.test']) {
    try {
      for (const line of readFileSync(join(process.cwd(), file), 'utf8').split(/\r?\n/)) {
        const t = line.trim()
        if (!t || t.startsWith('#')) continue
        const eq = t.indexOf('=')
        if (eq <= 0) continue
        out[t.slice(0, eq).trim()] = t
          .slice(eq + 1)
          .trim()
          .replace(/^["']|["']$/g, '')
      }
    } catch {
      /* the named check below reports a missing file better than this can */
    }
  }
  for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'E2E_TEAM_CODE', 'E2E_CLIENT_CODE']) {
    if (!out[key]) throw new Error(`${key} is missing from .env.test / .env.local`)
  }
  return out
}

const env = loadEnv()

export const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

/** Today, as `travel_legs.travel_date` stores it — the key `MeetArrivals` compares on. */
export function todayKey(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * The event the SESSION can see, which is not `E2E_EVENT_ID`.
 *
 * `E2E_TEAM_CODE` and `E2E_CLIENT_CODE` both resolve to `SAMPLE2026` in
 * `event_access_codes`; `E2E_EVENT_ID` names `E12345` ("Nuvent Event"), and a
 * session holding the team code is served the event home rather than a 404 when
 * it asks for `E12345` — so nothing about the failure is loud. FEEL-BASELINE.md
 * records the same trap.
 *
 * The code is taken from the access code's own event row rather than hardcoded,
 * so this keeps working if the codes are rotated onto another event.
 */
export async function sessionEvent() {
  const { createHash } = await import('node:crypto')
  const hash = (code) => createHash('sha256').update(code.replace('-', '')).digest('hex')

  const { data, error } = await db
    .from('event_access_codes')
    .select('id, event_id, role, events ( id, code, name )')
    .eq('code_hash', hash(env.E2E_TEAM_CODE))
    .is('revoked_at', null)
    .maybeSingle()

  if (error) throw new Error(`resolve the team access code's event: ${error.message}`)
  if (!data?.events) throw new Error('the team access code does not resolve to a live event')

  const client = await db
    .from('event_access_codes')
    .select('event_id')
    .eq('code_hash', hash(env.E2E_CLIENT_CODE))
    .is('revoked_at', null)
    .maybeSingle()

  return {
    id: data.events.id,
    code: data.events.code,
    name: data.events.name,
    teamCodeEventId: data.event_id,
    clientCodeEventId: client.data?.event_id ?? null,
    /** True when the two codes name the same event, which the spec asserts. */
    codesShareEvent: client.data?.event_id === data.event_id,
  }
}

/** A confirmed family with a named head guest — the shape every task needs. */
async function createFamily(eventId, headName, { headcount = 2, mobile, confirmed = true } = {}) {
  const { data: group, error } = await db
    .from('guest_groups')
    .insert({
      event_id: eventId,
      head_name: headName,
      primary_mobile: mobile ?? null,
      expected_pax: headcount,
      confirmed_pax: confirmed ? headcount : null,
      adults_confirmed: confirmed ? headcount : null,
      children_confirmed: 0,
      rsvp_status: confirmed ? 'confirmed' : 'not_started',
      side: 'bride',
    })
    .select('id')
    .single()
  if (error) throw new Error(`seed family ${headName}: ${error.message}`)

  const { data: guest, error: guestErr } = await db
    .from('guests')
    .insert({ event_id: eventId, group_id: group.id, full_name: headName, is_head: true })
    .select('id')
    .single()
  if (guestErr) throw new Error(`seed head guest for ${headName}: ${guestErr.message}`)

  return { groupId: group.id, guestId: guest.id }
}

async function deleteSeed() {
  const { data: groups, error } = await db
    .from('guest_groups')
    .select('id')
    .ilike('head_name', `${V12_PREFIX}%`)
  if (error) throw new Error(`read previous V12 seed: ${error.message}`)
  const ids = (groups ?? []).map((g) => g.id)

  // ---- The seeded room, and why it goes first ------------------------------
  //
  // `rooms` is `unique (hotel_id, room_number)`, so a leftover `V12-701` from an
  // interrupted run makes the next run's INSERT fail with a duplicate key rather
  // than re-creating anything. It therefore has to be removed even when the
  // families are already gone, which is why this runs before the `ids.length`
  // early return below.
  //
  // Order, and it is forced by two foreign keys that are deliberately NOT
  // cascading:
  //   1. `deliverables.room_id` and `.group_id` → cleared/removed by our own
  //      rows. A deliverable that already carries a proof cannot be deleted at
  //      ALL — `delivery_proofs` is insert-only with unconditional
  //      `block_mutation` triggers, and its FK to the deliverable is RESTRICT —
  //      so the reference is cleared rather than followed. The proof is the
  //      thing that must survive.
  //   2. `room_assignments.room_id` → these rows are ours (`event_id` + a
  //      `V12-`-headed group) and can go.
  const ourDeliverables = ids.length
    ? await db.from('deliverables').select('id').in('group_id', ids)
    : { data: [] }
  const deliverableIds = (ourDeliverables.data ?? []).map((d) => d.id)

  await db.from('room_assignments').delete().in('group_id', ids.length ? ids : ['none'])
  if (deliverableIds.length) {
    await db.from('deliverables').update({ room_id: null }).in('id', deliverableIds)
    await db.from('deliverables').delete().in('id', deliverableIds)
  }
  await db.from('rooms').delete().ilike('room_number', `${V12_PREFIX}%`)

  if (ids.length === 0) return

  // Order matters: assignments first (guests are referenced), then the guests,
  // then the group. Deliverables are only removed when no proof pins them —
  // `delivery_proofs` is insert-only with unconditional block_mutation triggers,
  // so a seeded deliverable that already carries a proof is permanent and its
  // group has to stay with it. The seed therefore uses a FRESH deliverable per
  // run and never depends on deleting the previous one.
  await db.from('room_assignments').delete().in('group_id', ids)
  await db.from('travel_legs').delete().in('group_id', ids)
  await db.from('deliverables').delete().in('group_id', ids)
  await db.from('guests').delete().in('group_id', ids)
  await db.from('guest_groups').delete().in('id', ids)
}

/**
 * Bring the fixtures up to date and return the ids the tasks need.
 *
 * Idempotent: running it twice leaves one set of rows, not two.
 */
export async function seed() {
  const event = await sessionEvent()
  if (!event.codesShareEvent) {
    throw new Error(
      `E2E_TEAM_CODE and E2E_CLIENT_CODE name different events ` +
        `(${event.teamCodeEventId} vs ${event.clientCodeEventId}). The client tasks cannot be ` +
        `measured against the same data as the staff tasks.`,
    )
  }

  await deleteSeed()

  const { data: hotel } = await db
    .from('hotels')
    .select('id, name')
    .eq('event_id', event.id)
    .limit(1)
    .maybeSingle()

  const found = await createFamily(event.id, FAMILIES.search, { headcount: 2, mobile: '9811100011' })
  // NOT confirmed, and that is what puts it in the calling list. `CallNext`'s
  // default preset is "Still to call" — `rsvp_status in (not_started, attempted)`
  // — so a confirmed family is invisible to the screen this task is about.
  const call = await createFamily(event.id, FAMILIES.call, {
    headcount: 2,
    mobile: '9811100022',
    confirmed: false,
  })
  const room = await createFamily(event.id, FAMILIES.room, { headcount: 2, mobile: '9811100033' })
  const hamper = await createFamily(event.id, FAMILIES.hamper, { headcount: 2, mobile: '9811100044' })
  const arrival = await createFamily(event.id, FAMILIES.arrival, { headcount: 2, mobile: '9811100055' })
  const clientRoom = await createFamily(event.id, FAMILIES.clientRoom, {
    headcount: 2,
    mobile: '9811100066',
  })
  const clientArrival = await createFamily(event.id, FAMILIES.clientArrival, {
    headcount: 2,
    mobile: '9811100077',
  })

  // A room the "give a family a room" task can actually place a family in. It is
  // created here rather than reusing a real one so the capacity arithmetic the
  // task depends on cannot be changed by another test's assignment.
  const { data: seedRoom, error: roomErr } = await db
    .from('rooms')
    .insert({
      event_id: event.id,
      hotel_id: hotel?.id ?? null,
      room_number: ROOM_NUMBER,
      capacity: 4,
      // `rooms.max_capacity` is NOT NULL and is the ceiling the room guard
      // actually enforces (`app.guard_room_capacity`); `capacity` is the base
      // the grid displays. Leaving it unset fails the insert, which is how this
      // line came to exist.
      max_capacity: 4,
      floor: '7',
    })
    .select('id')
    .single()
  if (roomErr) throw new Error(`seed room ${ROOM_NUMBER}: ${roomErr.message}`)

  // The room task's family must be UNPLACED (`placed === 0`) or it never appears
  // on the screen at all: `GiveRoom` renders `.filter((f) => f.placed === 0)`.
  // Nothing to assign, so nothing to do.

  // The hamper task's family needs a room, because the proof screen shows the
  // door the runner is standing at ("Room 412 · Hotel") and a hamper with no
  // door is not the job. One assignment, one bed.
  const { error: assignErr } = await db.from('room_assignments').insert({
    event_id: event.id,
    room_id: seedRoom.id,
    guest_id: hamper.guestId,
    group_id: hamper.groupId,
    is_override: false,
  })
  if (assignErr) throw new Error(`seed hamper room assignment: ${assignErr.message}`)

  // The client's "my own room" task needs a family whose guests are readable
  // through `client_guest_profiles` AND who holds a room. Same room, so the
  // screen has a real number to show.
  const { data: clientGuest } = await db
    .from('guests')
    .insert({
      event_id: event.id,
      group_id: clientRoom.groupId,
      full_name: `${FAMILIES.clientRoom} (guest 2)`,
      age_band: 'adult',
    })
    .select('id')
    .single()
  const { error: clientAssignErr } = await db.from('room_assignments').insert({
    event_id: event.id,
    room_id: seedRoom.id,
    guest_id: clientGuest?.id ?? clientRoom.guestId,
    group_id: clientRoom.groupId,
    is_override: false,
  })
  if (clientAssignErr) throw new Error(`seed client room assignment: ${clientAssignErr.message}`)

  // The hamper itself.
  const { data: deliverable, error: delivErr } = await db
    .from('deliverables')
    .insert({
      event_id: event.id,
      group_id: hamper.groupId,
      kind: 'hamper',
      item_name: `${V12_PREFIX}Hamper`,
      quantity: 1,
      status: 'pending',
      room_id: seedRoom.id,
    })
    .select('id')
    .single()
  if (delivErr) throw new Error(`seed deliverable: ${delivErr.message}`)

  // Two arrival legs landing TODAY: one for the staff task, one for the client's
  // "who is arriving today". `MeetArrivals` matches `travel_date` against the
  // DEVICE's local date (`toDateKey(new Date())`), so the seed writes local today
  // and both sides agree.
  const today = todayKey()
  const { error: legErr } = await db.from('travel_legs').insert([
    {
      event_id: event.id,
      group_id: arrival.groupId,
      direction: 'arrival',
      mode: 'air',
      travel_date: today,
      travel_time: '14:30',
      reference: 'V12 6E 5074',
      point: 'Ahmedabad T2',
      pax_on_leg: 2,
    },
    {
      event_id: event.id,
      group_id: clientArrival.groupId,
      direction: 'arrival',
      mode: 'train',
      travel_date: today,
      travel_time: '18:05',
      reference: 'V12 12951',
      point: 'Ahmedabad Jn',
      pax_on_leg: 2,
    },
  ])
  if (legErr) throw new Error(`seed arrival legs: ${legErr.message}`)

  // Members, so the room task's family has a placed head count to top up and the
  // rooms grid has rows to count.
  for (const family of [call, room, arrival]) {
    await db.from('guests').insert({
      event_id: event.id,
      group_id: family.groupId,
      full_name: `${V12_PREFIX}(guest 2)`,
      age_band: 'adult',
    })
  }

  return {
    event,
    hotelName: hotel?.name ?? null,
    roomId: seedRoom.id,
    roomNumber: ROOM_NUMBER,
    families: { ...FAMILIES, ids: {
      search: found.groupId,
      call: call.groupId,
      room: room.groupId,
      hamper: hamper.groupId,
      arrival: arrival.groupId,
      clientRoom: clientRoom.groupId,
      clientArrival: clientArrival.groupId,
    } },
    deliverableId: deliverable?.id ?? null,
    today,
  }
}

export async function unseed() {
  await deleteSeed()
}
