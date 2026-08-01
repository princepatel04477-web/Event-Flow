/**
 * Backend tests through the real API surface: PostgREST + GoTrue with actual
 * user JWTs. This is the layer the SQL suite does not exercise — it runs as
 * `postgres` via SET ROLE, which bypasses the grants that turned out to be
 * missing.
 *
 * Local stack only.
 */

const URL = 'http://127.0.0.1:54321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

let pass = 0
let fail = 0
const failures = []

function check(label, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  PASS  ${label}`)
  } else {
    fail++
    failures.push(`${label} ${detail}`)
    console.log(`  FAIL  ${label} ${detail}`)
  }
}

async function api(path, { token = ANON, method = 'GET', body, prefer } = {}) {
  const res = await fetch(`${URL}${path}`, {
    method,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {}
  return { status: res.status, json, text }
}

async function signIn(email, password) {
  const res = await api('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email, password },
  })
  if (!res.json?.access_token) throw new Error(`sign-in failed for ${email}: ${res.text}`)
  return res.json.access_token
}

async function createUser(email, password) {
  const res = await api('/auth/v1/admin/users', {
    token: SERVICE,
    method: 'POST',
    body: { email, password, email_confirm: true },
  })
  if (res.json?.id) return res.json.id
  // already exists — look it up
  const list = await api(`/auth/v1/admin/users?per_page=200`, { token: SERVICE })
  const found = (list.json?.users ?? []).find((u) => u.email === email)
  if (!found) throw new Error(`could not create or find ${email}: ${res.text}`)
  return found.id
}

console.log('\n=== 1. Unauthenticated access ===')
{
  const r = await api('/rest/v1/guest_groups?select=id')
  check(
    'anon cannot read guest_groups',
    r.status === 401 || (Array.isArray(r.json) && r.json.length === 0),
    `status=${r.status} body=${r.text.slice(0, 120)}`,
  )
}

console.log('\n=== 2. Staff sees only their own event ===')
const adminToken = await signIn('admin@eventflow.test', 'TestSprite!2026')
let eventA, groupA
{
  const r = await api('/rest/v1/events?select=id,code', { token: adminToken })
  check('admin can list events', r.status === 200 && Array.isArray(r.json), `status=${r.status}`)
  eventA = (r.json ?? []).find((e) => e.code === 'TSTEST')
  check('seeded event TSTEST visible', Boolean(eventA))

  const g = await api(
    `/rest/v1/guest_groups?select=id,head_name&event_id=eq.${eventA.id}`,
    { token: adminToken },
  )
  check('admin reads guest_groups', g.status === 200 && (g.json ?? []).length >= 2, `status=${g.status} n=${(g.json??[]).length}`)
  groupA = (g.json ?? [])[0]
}

// Second event + a user who is event_team on it only.
console.log('\n=== 3. Cross-event isolation ===')
{
  const otherUserId = await createUser('other@eventflow.test', 'TestSprite!2026')

  // Build event B and membership with the service role via SQL-equivalent REST.
  // events insert requires app.is_admin(); do it as our admin.
  let eventB
  const existing = await api('/rest/v1/events?code=eq.OTHER&select=id,code', { token: adminToken })
  if ((existing.json ?? []).length > 0) {
    eventB = existing.json[0]
  } else {
    const mk = await api('/rest/v1/events', {
      token: adminToken,
      method: 'POST',
      prefer: 'return=representation',
      body: { name: 'Other Wedding', code: 'OTHER', starts_on: '2026-11-01', ends_on: '2026-11-03' },
    })
    eventB = (mk.json ?? [])[0]
    check('admin can create a second event', Boolean(eventB), mk.text.slice(0, 140))
  }

  // A group inside event B, created by the admin.
  const gb = await api('/rest/v1/guest_groups', {
    token: adminToken,
    method: 'POST',
    prefer: 'return=representation',
    body: { event_id: eventB.id, head_name: 'Other Family', expected_pax: 2 },
  })
  const groupB = (gb.json ?? [])[0]

  // Make other@ an event_team member of event B ONLY.
  await api('/rest/v1/event_members', {
    token: adminToken,
    method: 'POST',
    body: { event_id: eventB.id, user_id: otherUserId, role: 'event_team' },
  })

  const otherToken = await signIn('other@eventflow.test', 'TestSprite!2026')

  const seenA = await api(`/rest/v1/guest_groups?select=id&event_id=eq.${eventA.id}`, {
    token: otherToken,
  })
  check(
    'event_team of B sees ZERO rows from event A',
    seenA.status === 200 && (seenA.json ?? []).length === 0,
    `status=${seenA.status} n=${(seenA.json ?? []).length}`,
  )

  const seenB = await api(`/rest/v1/guest_groups?select=id&event_id=eq.${eventB.id}`, {
    token: otherToken,
  })
  check(
    'event_team of B sees its own rows',
    seenB.status === 200 && (seenB.json ?? []).length >= 1,
    `status=${seenB.status} n=${(seenB.json ?? []).length}`,
  )

  // Cross-event write: point a guest in event B's group at event A.
  const crossInsert = await api('/rest/v1/guests', {
    token: otherToken,
    method: 'POST',
    body: { event_id: eventA.id, group_id: groupB.id, full_name: 'Smuggled', is_head: false },
  })
  check(
    'cross-event guest insert refused',
    crossInsert.status >= 400,
    `status=${crossInsert.status} ${crossInsert.text.slice(0, 120)}`,
  )

  // Deleting is admin-only.
  const del = await api(`/rest/v1/guest_groups?id=eq.${groupB.id}`, {
    token: otherToken,
    method: 'DELETE',
    prefer: 'return=representation',
  })
  check(
    'event_team cannot delete a group',
    del.status >= 400 || (Array.isArray(del.json) && del.json.length === 0),
    `status=${del.status} n=${Array.isArray(del.json) ? del.json.length : 'n/a'}`,
  )
}

console.log('\n=== 4. Group locking (claim_group) ===')
{
  const claim1 = await api('/rest/v1/rpc/claim_group', {
    token: adminToken,
    method: 'POST',
    body: { p_group_id: groupA.id },
  })
  check('first claim succeeds', claim1.status === 200, `status=${claim1.status} ${claim1.text.slice(0,120)}`)

  const otherToken = await signIn('other@eventflow.test', 'TestSprite!2026')
  const claim2 = await api('/rest/v1/rpc/claim_group', {
    token: otherToken,
    method: 'POST',
    body: { p_group_id: groupA.id },
  })
  check(
    'second caller refused the locked group',
    claim2.status >= 400 || claim2.json === false || claim2.json === null,
    `status=${claim2.status} body=${claim2.text.slice(0, 120)}`,
  )
}

console.log('\n=== 5. apply_rsvp_extraction: the only write path ===')
{
  const ex = await api(
    `/rest/v1/rsvp_extractions?select=id,status,group_id&status=eq.pending&limit=1`,
    { token: adminToken },
  )
  const pending = (ex.json ?? [])[0]
  check('a pending extraction exists to apply', Boolean(pending), ex.text.slice(0, 120))

  if (pending) {
    const payload = {
      rsvp_status: 'confirmed',
      confirmed_pax: 4,
      remarks: 'wheelchair for mother',
      arrival: {
        mode: 'air',
        date: '2026-12-20',
        time: '10:30',
        reference: '6E 5074',
        point: 'Ahmedabad T2',
        pax: 4,
      },
    }

    const apply1 = await api('/rest/v1/rpc/apply_rsvp_extraction', {
      token: adminToken,
      method: 'POST',
      body: { p_extraction_id: pending.id, p_payload: payload },
    })
    check('first apply succeeds', apply1.status === 200, `status=${apply1.status} ${apply1.text.slice(0,160)}`)

    // Group and legs must both reflect the commit.
    const grp = await api(
      `/rest/v1/guest_groups?select=rsvp_status,confirmed_pax,remarks,locked_by&id=eq.${pending.group_id}`,
      { token: adminToken },
    )
    const g = (grp.json ?? [])[0]
    check('group rsvp_status updated', g?.rsvp_status === 'confirmed', String(g?.rsvp_status))
    check('group confirmed_pax updated', g?.confirmed_pax === 4, String(g?.confirmed_pax))
    check('special_requests landed in remarks', g?.remarks === 'wheelchair for mother', String(g?.remarks))
    check('caller lock released by the same call', g?.locked_by === null, String(g?.locked_by))

    const legs = await api(
      `/rest/v1/travel_legs?select=direction,travel_date,reference&group_id=eq.${pending.group_id}&direction=eq.arrival`,
      { token: adminToken },
    )
    const leg = (legs.json ?? [])[0]
    check('arrival leg updated in the same transaction', leg?.travel_date === '2026-12-20', String(leg?.travel_date))
    check('arrival reference updated', leg?.reference === '6E 5074', String(leg?.reference))

    // Re-apply must be refused.
    const apply2 = await api('/rest/v1/rpc/apply_rsvp_extraction', {
      token: adminToken,
      method: 'POST',
      body: { p_extraction_id: pending.id, p_payload: payload },
    })
    check(
      'RE-APPLY refused (already accepted)',
      apply2.status >= 400,
      `status=${apply2.status} ${apply2.text.slice(0, 160)}`,
    )
  }
}

console.log('\n=== 6. Server clock overrides device time ===')
{
  // call_attempts stamps started_at server-side and moves the client value to
  // device_started_at.
  const attempt = await api('/rest/v1/call_attempts', {
    token: adminToken,
    method: 'POST',
    prefer: 'return=representation',
    body: {
      event_id: eventA.id,
      group_id: groupA.id,
      dialed_number: '9876543210',
      started_at: '2020-01-01T00:00:00Z', // a phone with a wrong clock
    },
  })
  const row = (attempt.json ?? [])[0]
  check('call attempt insert accepted', attempt.status < 300, `status=${attempt.status} ${attempt.text.slice(0,140)}`)
  if (row) {
    const year = new Date(row.started_at).getUTCFullYear()
    check('server clock overwrote the phone claim', year >= 2026, `started_at=${row.started_at}`)
    check(
      'phone claim preserved as device_started_at',
      row.device_started_at?.startsWith('2020'),
      `device_started_at=${row.device_started_at}`,
    )

    // Finalise, then confirm the row freezes.
    const fin = await api(`/rest/v1/call_attempts?id=eq.${row.id}`, {
      token: adminToken,
      method: 'PATCH',
      prefer: 'return=representation',
      body: { outcome: 'no_answer', ended_at: new Date().toISOString() },
    })
    check('first completion accepted', fin.status < 300, `status=${fin.status}`)

    const second = await api(`/rest/v1/call_attempts?id=eq.${row.id}`, {
      token: adminToken,
      method: 'PATCH',
      prefer: 'return=representation',
      body: { outcome: 'confirmed' },
    })
    check(
      'finalized attempt is frozen against a second write',
      second.status >= 400,
      `status=${second.status} ${second.text.slice(0, 140)}`,
    )

    const delAttempt = await api(`/rest/v1/call_attempts?id=eq.${row.id}`, {
      token: adminToken,
      method: 'DELETE',
    })
    check('call attempt delete blocked', delAttempt.status >= 400, `status=${delAttempt.status}`)
  }
}

console.log('\n========== TALLY ==========')
console.log(`PASS: ${pass}`)
console.log(`FAIL: ${fail}`)
if (failures.length) {
  console.log('\nFailures:')
  for (const f of failures) console.log(' -', f)
}
process.exit(fail === 0 ? 0 : 1)
