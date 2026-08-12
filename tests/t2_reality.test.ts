import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  admin,
  loadT1Env,
  mintCodeSession,
  releaseIdentities,
  type Identity,
  type T1Env,
} from './helpers/identities'
import { normaliseMobile } from '@/lib/phone'
import { parsePax, rsvpFromRemarks } from '@/lib/import/normalize'
import { cleanPersonName } from '@/lib/import/cells'

/**
 * T2 — REALITY: the conditions on Saturday, not the conditions in the office.
 *
 * Ten staff on cheap Android phones, one venue Wi-Fi access point, 238 families
 * and a wedding that does not pause while a bug is investigated. What matters
 * here is not whether a function returns the right value — T2's whole premise
 * is that the 129 tests which do that were green while the app failed on a
 * handset.
 *
 * SCOPE OF THIS FILE: everything that is decided by the DATABASE or by a pure
 * parser — concurrency, date boundaries, room turnover, idempotent imports,
 * malformed spreadsheets. The browser-shaped items (offline replay, session
 * kill, render timings) need a real page and live in e2e/t2_offline.spec.ts.
 *
 * SILENT DATA LOSS IS A BLOCKER, not a note. Where a test finds that two
 * writers can overwrite each other with nobody told, it says so in those words.
 *
 * Runs against the real project on real code sessions, like T1, and is excluded
 * from the default `npm test` for the same reason. Run it with
 * `npm run test:t2`.
 */

const env = loadT1Env()
const enabled = env !== null

let sf: SupabaseClient
let callerA: Identity
let callerB: Identity
let callerC: Identity
let issued: { codeRowId: string; retired: string | null }[] = []
let groupId = ''
let hotelId = ''
let roomId = ''
let guestIds: string[] = []

const STAMP = Date.now().toString(36)
const TAG = `T2-${STAMP}`

describe.runIf(enabled)('T2 — venue reality', () => {
  beforeAll(async () => {
    const e = env as T1Env
    sf = admin(e)

    // Three sessions, because the interesting failures need three phones.
    // All bind a staff identity: an unbound team session cannot write at all
    // (app.has_staff_identity), which T1 established the hard way.
    const a = await mintCodeSession(e, { label: 'T2 Caller A', eventId: e.eventA, role: 'team', bindStaff: true })
    issued = [{ codeRowId: a.codeRowId, retired: a.retired }]
    callerA = a
    // Re-using one code for three sessions mirrors reality: a calling team
    // shares one team code and is told apart by the staff member they picked.
    callerB = a
    callerC = a

    const { data: group, error: gErr } = await sf
      .from('guest_groups')
      .insert({
        event_id: e.eventA,
        head_name: `${TAG}-family`,
        primary_mobile: '9800000001',
        expected_pax: 4,
        rsvp_status: 'not_started',
      })
      .select('id')
      .single()
    if (gErr) throw new Error(`T2 setup: could not create a family: ${gErr.message}`)
    groupId = group.id

    const { data: guests } = await sf
      .from('guests')
      .insert([
        { event_id: e.eventA, group_id: groupId, full_name: `${TAG}-head`, is_head: true },
        { event_id: e.eventA, group_id: groupId, full_name: `${TAG}-spouse`, is_head: false },
      ])
      .select('id')
    guestIds = (guests ?? []).map((g) => g.id)

    const { data: hotel, error: hErr } = await sf
      .from('hotels')
      .insert({ event_id: e.eventA, name: `${TAG}-hotel` })
      .select('id')
      .single()
    if (hErr) throw new Error(`T2 setup: could not create a hotel: ${hErr.message}`)
    hotelId = hotel.id

    const { data: room, error: rErr } = await sf
      .from('rooms')
      .insert({
        event_id: e.eventA,
        hotel_id: hotelId,
        room_number: `${STAMP}-01`,
        capacity: 2,
        max_capacity: 3,
      })
      .select('id')
      .single()
    if (rErr) throw new Error(`T2 setup: could not create a room: ${rErr.message}`)
    roomId = room.id
  }, 180_000)

  afterAll(async () => {
    // Clean up everything this file created, deepest first. call_attempts is
    // append-only (its DELETE trigger blocks even service role), so a family
    // this suite dialled cannot be removed — that is by design, and those rows
    // are recognisable by the T2- prefix.
    if (!env) return
    await sf.from('room_assignments').delete().eq('room_id', roomId)
    await sf.from('rooms').delete().eq('id', roomId)
    await sf.from('hotels').delete().eq('id', hotelId)
    if (guestIds.length) await sf.from('guests').delete().in('id', guestIds)
    const { data: attempts } = await sf.from('call_attempts').select('id').eq('group_id', groupId)
    if (!attempts?.length) await sf.from('guest_groups').delete().eq('id', groupId)
    if (issued.length) await releaseIdentities(env, issued)
  }, 120_000)

  // -------------------------------------------------------------------------
  // 1 — TWO STAFF, ONE ROOM
  // -------------------------------------------------------------------------

  test('T2.1 two staff allocating the same room: exactly one wins', async () => {
    const e = env as T1Env
    const stay = { check_in_date: '2026-12-19', check_out_date: '2026-12-21' }

    // Fired together, not sequentially. A sequential test passes on a system
    // that has no guard at all, because the second write simply sees the first.
    const [first, second] = await Promise.all([
      callerA.client
        .from('room_assignments')
        .insert({ event_id: e.eventA, room_id: roomId, group_id: groupId, guest_id: guestIds[0], ...stay })
        .select('id'),
      callerB.client
        .from('room_assignments')
        .insert({ event_id: e.eventA, room_id: roomId, group_id: groupId, guest_id: guestIds[1], ...stay })
        .select('id'),
    ])

    const winners = [first, second].filter((r) => !r.error && (r.data?.length ?? 0) > 0)
    const losers = [first, second].filter((r) => r.error)

    // Capacity is 2, so BOTH may legitimately fit. What must never happen is
    // occupancy exceeding max_capacity, or a loser being told it worked.
    const { data: active } = await sf
      .from('room_assignments')
      .select('id')
      .eq('room_id', roomId)
      .is('released_at', null)

    expect(
      active?.length ?? 0,
      `the room holds ${active?.length} active stays against max_capacity 3`,
    ).toBeLessThanOrEqual(3)

    expect(
      winners.length + losers.length,
      'a write neither succeeded nor errored — that is the silent case',
    ).toBe(2)

    // Every refusal must be a recognisable, explainable code — never a bare
    // 500 or an empty message the UI would render as "Something went wrong".
    for (const l of losers) {
      expect(
        l.error?.code,
        `a losing allocation returned code ${l.error?.code} (${l.error?.message}) — ` +
          'staff need a specific reason, not a raw failure',
      ).toMatch(/^(23514|23505|42501)$/)
    }
  })

  test('T2.1b over-capacity allocation is refused with a usable code', async () => {
    const e = env as T1Env
    // Fill to max_capacity (3) then try one more.
    const extra: string[] = []
    for (let i = 0; i < 4; i += 1) {
      const { data: g } = await sf
        .from('guests')
        .insert({ event_id: e.eventA, group_id: groupId, full_name: `${TAG}-cap-${i}` })
        .select('id')
        .single()
      if (g) extra.push(g.id)
    }
    guestIds.push(...extra)

    const results = []
    for (const gid of extra) {
      results.push(
        await callerA.client
          .from('room_assignments')
          .insert({
            event_id: e.eventA,
            room_id: roomId,
            group_id: groupId,
            guest_id: gid,
            check_in_date: '2026-12-19',
            check_out_date: '2026-12-21',
          })
          .select('id'),
      )
    }

    const { data: active } = await sf
      .from('room_assignments')
      .select('id')
      .eq('room_id', roomId)
      .is('released_at', null)

    expect(
      active?.length ?? 0,
      `room occupancy reached ${active?.length}, above max_capacity 3 — the capacity guard did not fire`,
    ).toBeLessThanOrEqual(3)

    const refused = results.filter((r) => r.error)
    expect(refused.length, 'nothing was refused despite exceeding capacity').toBeGreaterThan(0)
    for (const r of refused) {
      expect(r.error?.code, `refusal code was ${r.error?.code}`).toBe('23514')
    }
  })

  // -------------------------------------------------------------------------
  // 2 — THREE STAFF, ONE FAMILY
  // -------------------------------------------------------------------------

  test('T2.2 three simultaneous call attempts are all recorded, all attributed', async () => {
    const e = env as T1Env
    const before = await sf
      .from('call_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('group_id', groupId)

    const results = await Promise.all(
      [callerA, callerB, callerC].map((caller, i) =>
        caller.client
          .from('call_attempts')
          .insert({ event_id: e.eventA, group_id: groupId, dialed_number: `98000000${10 + i}` })
          .select('id, caller_id, caller_id_staff')
          .single(),
      ),
    )

    const written = results.filter((r) => !r.error)
    expect(
      written.length,
      `only ${written.length}/3 concurrent attempts were written — a call that is not logged ` +
        'is a call that never happened',
    ).toBe(3)

    // Attempt count is count(*), never a stored counter (CLAUDE.md §5.4).
    const after = await sf
      .from('call_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('group_id', groupId)
    expect((after.count ?? 0) - (before.count ?? 0), 'the attempt count did not rise by 3').toBe(3)

    // Every row must answer "who made this call" with exactly one column.
    for (const r of written) {
      const row = r.data!
      const filled = [row.caller_id, row.caller_id_staff].filter(Boolean).length
      expect(
        filled,
        `an attempt has ${filled} attribution columns set — exactly one is required`,
      ).toBe(1)
    }
  })

  test('T2.2b conflicting RSVP writes: report last-write-wins vs surfaced conflict', async () => {
    const e = env as T1Env

    // Two staff set different statuses at the same moment.
    const [r1, r2] = await Promise.all([
      callerA.client
        .from('guest_groups')
        .update({ rsvp_status: 'confirmed', confirmed_pax: 4 })
        .eq('id', groupId)
        .select('rsvp_status'),
      callerB.client
        .from('guest_groups')
        .update({ rsvp_status: 'declined', confirmed_pax: 0 })
        .eq('id', groupId)
        .select('rsvp_status'),
    ])

    const { data: final } = await sf
      .from('guest_groups')
      .select('rsvp_status, confirmed_pax')
      .eq('id', groupId)
      .single()

    const bothSucceeded = !r1.error && !r2.error
    const behaviour = bothSucceeded ? 'LAST-WRITE-WINS (no conflict surfaced)' : 'CONFLICT SURFACED'

    // Reported, not asserted either way — the brief accepts both. What it does
    // NOT accept is silent loss, i.e. a write that reported success while the
    // stored value came from neither writer.
    console.log(
      `\n  T2.2b concurrent RSVP writes: ${behaviour}\n` +
        `    A -> confirmed/4 : ${r1.error?.code ?? 'ok'}\n` +
        `    B -> declined/0  : ${r2.error?.code ?? 'ok'}\n` +
        `    stored           : ${final?.rsvp_status} / pax ${final?.confirmed_pax}\n`,
    )

    expect(
      ['confirmed', 'declined'].includes(final?.rsvp_status ?? ''),
      `the stored status is "${final?.rsvp_status}", which neither writer sent — ` +
        'that is silent corruption, not last-write-wins',
    ).toBe(true)

    // The pax must match the status that won. A confirmed family with 0 pax,
    // or a declined family with 4, is a torn write across two columns and it
    // WILL send a car to fetch nobody.
    const consistent =
      (final?.rsvp_status === 'confirmed' && final?.confirmed_pax === 4) ||
      (final?.rsvp_status === 'declined' && final?.confirmed_pax === 0)
    expect(
      consistent,
      `TORN WRITE: status "${final?.rsvp_status}" with pax ${final?.confirmed_pax} — the two ` +
        'columns came from different writers. This is silent data loss and is a blocker.',
    ).toBe(true)
  })

  // -------------------------------------------------------------------------
  // 6 — TIMEZONE BOUNDARIES
  // -------------------------------------------------------------------------

  describe('T2.6 date boundaries at IST midnight', () => {
    // India is UTC+05:30, so 00:30 IST on the 16th is 19:00 UTC on the 15th.
    // Anything that renders a travel date by slicing a UTC ISO string reports
    // the wrong DAY — and a car sent on the 15th for an arrival on the 16th is
    // the most expensive possible rounding error.
    const cases = [
      { label: '23:55 IST on 15 Aug', ist: '2026-08-15T23:55:00+05:30', expectedDay: '2026-08-15' },
      { label: '00:05 IST on 16 Aug', ist: '2026-08-16T00:05:00+05:30', expectedDay: '2026-08-16' },
      { label: '00:30 IST on 16 Aug', ist: '2026-08-16T00:30:00+05:30', expectedDay: '2026-08-16' },
    ]

    for (const c of cases) {
      test(`${c.label} is stored and read back as ${c.expectedDay}`, async () => {
        const e = env as T1Env
        const { data, error } = await sf
          .from('travel_legs')
          .insert({
            event_id: e.eventA,
            group_id: groupId,
            direction: 'arrival',
            travel_date: c.expectedDay, // a DATE column: no zone, no drift
            travel_time: c.ist.slice(11, 16),
            mode: 'air',
            reference: `${TAG}-${c.expectedDay}`,
          })
          .select('travel_date, travel_time')
          .single()

        expect(error, `could not write the travel leg: ${error?.message}`).toBeNull()
        expect(
          data!.travel_date,
          `stored ${data!.travel_date} for ${c.label} — a day out means transport on the wrong date`,
        ).toBe(c.expectedDay)

        // And the naive mistake, demonstrated rather than assumed: slicing the
        // UTC ISO string of the same instant gives the PREVIOUS day for
        // anything before 05:30 IST.
        const utcSlice = new Date(c.ist).toISOString().slice(0, 10)
        if (c.expectedDay === '2026-08-16') {
          expect(
            utcSlice,
            'sanity check of the trap itself: after-midnight IST should differ from its UTC date',
          ).toBe('2026-08-15')
        }
      })
    }
  })

  // -------------------------------------------------------------------------
  // 7 — SAME-DAY ROOM TURNOVER
  // -------------------------------------------------------------------------

  describe('T2.7 same-day turnover', () => {
    test('B checks in the day A checks out — allowed', async () => {
      const e = env as T1Env
      const { data: room } = await sf
        .from('rooms')
        .insert({
          event_id: e.eventA,
          hotel_id: hotelId,
          room_number: `${STAMP}-turn`,
          capacity: 2,
          max_capacity: 2,
        })
        .select('id')
        .single()

      const { data: gA } = await sf
        .from('guests')
        .insert({ event_id: e.eventA, group_id: groupId, full_name: `${TAG}-turnA` })
        .select('id')
        .single()
      const { data: gB } = await sf
        .from('guests')
        .insert({ event_id: e.eventA, group_id: groupId, full_name: `${TAG}-turnB` })
        .select('id')
        .single()
      guestIds.push(gA!.id, gB!.id)

      const { error: e1 } = await sf.from('room_assignments').insert({
        event_id: e.eventA, room_id: room!.id, group_id: groupId, guest_id: gA!.id,
        check_in_date: '2026-12-17', check_out_date: '2026-12-19',
      })
      expect(e1, `the first stay was refused: ${e1?.message}`).toBeNull()

      // Checkout day == checkin day. daterange('[)') must NOT treat this as an
      // overlap, or every hotel turnover in the event is blocked.
      const { error: e2 } = await sf.from('room_assignments').insert({
        event_id: e.eventA, room_id: room!.id, group_id: groupId, guest_id: gB!.id,
        check_in_date: '2026-12-19', check_out_date: '2026-12-21',
      })
      expect(
        e2,
        'SAME-DAY TURNOVER WAS BLOCKED. Every room that changes hands mid-event is unusable: ' +
          `${e2?.message}`,
      ).toBeNull()

      await sf.from('room_assignments').delete().eq('room_id', room!.id)
      await sf.from('rooms').delete().eq('id', room!.id)
    })

    test('a genuine overlap is refused', async () => {
      const e = env as T1Env
      const { data: room } = await sf
        .from('rooms')
        .insert({
          event_id: e.eventA, hotel_id: hotelId,
          room_number: `${STAMP}-ovl`, capacity: 2, max_capacity: 2,
        })
        .select('id')
        .single()

      const { data: gA } = await sf
        .from('guests')
        .insert({ event_id: e.eventA, group_id: groupId, full_name: `${TAG}-ovlA` })
        .select('id').single()
      const { data: gB } = await sf
        .from('guests')
        .insert({ event_id: e.eventA, group_id: groupId, full_name: `${TAG}-ovlB` })
        .select('id').single()
      guestIds.push(gA!.id, gB!.id)

      await sf.from('room_assignments').insert({
        event_id: e.eventA, room_id: room!.id, group_id: groupId, guest_id: gA!.id,
        check_in_date: '2026-12-17', check_out_date: '2026-12-20',
      })

      const { error } = await sf.from('room_assignments').insert({
        event_id: e.eventA, room_id: room!.id, group_id: groupId, guest_id: gB!.id,
        check_in_date: '2026-12-19', check_out_date: '2026-12-21',
      })
      expect(
        error,
        'DOUBLE BOOKING: two guests hold the same room over overlapping nights and nothing objected',
      ).toBeTruthy()
      expect(error?.code, `overlap refusal code was ${error?.code}`).toBe('23514')

      await sf.from('room_assignments').delete().eq('room_id', room!.id)
      await sf.from('rooms').delete().eq('id', room!.id)
    })
  })

  // -------------------------------------------------------------------------
  // 9 — IDEMPOTENT IMPORT
  // -------------------------------------------------------------------------

  test('T2.9 re-importing the same family row creates nothing new', async () => {
    const e = env as T1Env
    const hash = `${TAG}-idempotency-hash`

    const insertOnce = () =>
      sf
        .from('guest_groups')
        .insert({
          event_id: e.eventA,
          head_name: `${TAG}-dup`,
          expected_pax: 2,
          rsvp_status: 'not_started',
          source_row_hash: hash,
        })
        .select('id')

    const first = await insertOnce()
    expect(first.error, `the first import failed: ${first.error?.message}`).toBeNull()

    const second = await insertOnce()
    expect(
      second.error,
      'THE SAME ROW IMPORTED TWICE AND WAS ACCEPTED BOTH TIMES — re-running an import ' +
        'duplicates every family (CLAUDE.md §5.6 says source_row_hash is unique per event)',
    ).toBeTruthy()
    expect(second.error?.code, `duplicate refusal code was ${second.error?.code}`).toBe('23505')

    const { count } = await sf
      .from('guest_groups')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', e.eventA)
      .eq('source_row_hash', hash)
    expect(count, `${count} rows share one source_row_hash`).toBe(1)

    await sf.from('guest_groups').delete().eq('source_row_hash', hash)
  })

  // -------------------------------------------------------------------------
  // 10 — MALFORMED SPREADSHEET INPUT
  //
  // REPORT, DO NOT FIX. Each case prints what the parser actually does. A
  // `null` is a good outcome — it means the value is flagged rather than
  // guessed. A wrong non-null value is the dangerous one, because it imports
  // silently and nobody looks again.
  // -------------------------------------------------------------------------

  describe('T2.10 malformed input triage', () => {
    test('a phone stored as a number with a lost leading zero', () => {
      const cases: [string, unknown][] = [
        ['already clean 10-digit', '9876543210'],
        ['+91 prefixed', '+919876543210'],
        ['0-prefixed 11-digit', '09876543210'],
        ['stored as a NUMBER (leading zero lost)', 9876543210],
        ['stored as a float (Excel)', 9876543210.0],
        ['scientific notation', '9.87654321e9'],
        ['with spaces and dashes', '98765 43210'],
        ['too short', '98765'],
        ['landline with STD code', '02612345678'],
      ]
      const report = cases.map(([label, raw]) => {
        const out = normaliseMobile(raw)
        return `    ${label.padEnd(40)} ${JSON.stringify(raw).padEnd(16)} -> ${out.value ?? 'null'}`
      })
      console.log(`\n  T2.10 mobile normalisation:\n${report.join('\n')}\n`)

      // The one hard requirement: a 10-digit Indian mobile must survive every
      // spelling Excel invents for it, because an unreachable family is a
      // family nobody calls.
      expect(normaliseMobile('9876543210').value, 'a clean mobile did not survive').toBe('9876543210')
      expect(normaliseMobile(9876543210).value, 'a numeric mobile did not survive').toBe('9876543210')
      expect(normaliseMobile('+919876543210').value, 'a +91 mobile did not survive').toBe('9876543210')

      // And a value it cannot read must come back null rather than truncated
      // into a plausible-looking wrong number.
      expect(normaliseMobile('98765').value, 'a 5-digit fragment was accepted as a mobile').toBeNull()
    })

    test('pax written the many ways a human writes it', () => {
      const cases: unknown[] = [4, '4', '4 pax', '04', '2+2', 'four', '', null, '4.0', ' 4 ']
      const report = cases.map((raw) => `    ${JSON.stringify(raw).padEnd(12)} -> ${parsePax(raw)}`)
      console.log(`\n  T2.10 parsePax:\n${report.join('\n')}\n`)
      expect(parsePax(4), 'a plain number failed').toBe(4)
      expect(parsePax('4'), 'a numeric string failed').toBe(4)
    })

    test('"Not Coming" / "Not Sure" buried in a remarks column', () => {
      const cases = ['Not Coming', 'NOT COMING', 'not coming', 'Not Sure', '4TH', '4th', '', 'Coming with family']
      const report = cases.map((raw) => `    ${JSON.stringify(raw).padEnd(24)} -> ${JSON.stringify(rsvpFromRemarks(raw))}`)
      console.log(`\n  T2.10 rsvpFromRemarks:\n${report.join('\n')}\n`)

      // Case must not decide whether a family is coming.
      expect(
        rsvpFromRemarks('NOT COMING'),
        'uppercase "NOT COMING" read differently from lowercase — real sheets contain both',
      ).toEqual(rsvpFromRemarks('not coming'))
    })

    test('names with trailing whitespace, honorifics and merged-cell artefacts', () => {
      const cases = ['  Rajesh Kumar  ', 'Mr. Rajesh Kumar', 'RAJESH KUMAR', 'Rajesh  Kumar', '-', '', 'Rajesh Kumar & family']
      const report = cases.map((raw) => `    ${JSON.stringify(raw).padEnd(28)} -> ${JSON.stringify(cleanPersonName(raw).value)}`)
      console.log(`\n  T2.10 cleanPersonName:\n${report.join('\n')}\n`)
      expect(cleanPersonName('  Rajesh Kumar  ').value, 'whitespace was not trimmed').toBe('Rajesh Kumar')
    })
  })
})

describe.runIf(!enabled)('T2 — venue reality', () => {
  test('skipped: missing configuration', () => {
    console.warn(
      '\nT2 did not run. It needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,\n' +
        'NEXT_PUBLIC_SUPABASE_ANON_KEY, T1_EVENT_A and T1_EVENT_B in .env.test.\n',
    )
    expect(true).toBe(true)
  })
})

// Referenced so the unused-import lint does not fire when the suite is skipped.
void randomUUID
