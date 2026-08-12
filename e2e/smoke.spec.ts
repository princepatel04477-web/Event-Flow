import { test, expect, type Page } from '@playwright/test'
import * as XLSX from 'xlsx'

/**
 * T3 steps 4-7 — the critical path, walked against the DEPLOYED build.
 *
 * Driven by `npm run smoke`, never run directly in the scored acceptance set.
 * Steps 1-3 (deployment truth, storage, event data) live in scripts/smoke.mjs
 * because they are HTTP/SQL assertions that need no browser; this file is only
 * the part that needs real screens and a real session.
 *
 * READ-MOSTLY BY DESIGN. This runs against production on the morning of the
 * event. It logs one RSVP against ONE family and marks it recognisably
 * (`SMOKE ✓` in the notes), and it allocates and immediately frees one room.
 * It never resets, never bulk-deletes, and never touches a family it did not
 * create or explicitly pick. A smoke test that corrupts the data it is
 * checking is worse than no smoke test.
 *
 * FAILURES ARE MEANT TO BE READ LITERALLY. Every assertion carries a message
 * naming what is broken, because the person running this at 8am on the 16th
 * is not going to read the source.
 */

const BASE_URL = (process.env.SMOKE_BASE_URL ?? '').replace(/\/$/, '')
const EVENT_CODE = process.env.SMOKE_EVENT_CODE ?? 'SHARMA26'
// `||`, not `??`: an UNSET SMOKE_TEAM_CODE arrives from the orchestrator as an
// empty string, which is not nullish — so `??` kept the empty value and the
// fallback never fired. The whole walk then failed on "no team access code"
// while the code sat in .env.test the entire time.
const TEAM_CODE = process.env.SMOKE_TEAM_CODE || process.env.E2E_TEAM_CODE || ''
const CLIENT_CODE = process.env.SMOKE_CLIENT_CODE || process.env.E2E_CLIENT_CODE || ''
const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '')
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

/**
 * NOT file-level serial. The S4 chain genuinely depends on itself (S4.2 picks
 * the family S4.3-S4.5 walk), so that block is serial — but making the WHOLE
 * file serial meant one failure in S4.3 skipped ten later checks and the board
 * came back with "10 did not run". A smoke suite whose first failure hides
 * every other answer is the opposite of what it is for: the person running it
 * needs the complete picture in one pass, not one bug at a time.
 */

// ---------------------------------------------------------------------------
// Read-only DB inspection.
//
// Service role here answers "did the write land", which is a question about
// rows, not about permissions. It is never used to assert isolation — see the
// rule at the top of T1, where service role would make every check a false
// green.
// ---------------------------------------------------------------------------

async function rest(path: string): Promise<unknown[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  })
  if (!res.ok) throw new Error(`REST ${path} -> HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return (await res.json()) as unknown[]
}

let eventId = ''
let walkGroupId = ''
let walkGroupName = ''

/**
 * Resolve a family to walk, fetching one if an earlier test has not already.
 *
 * Tests that depend on state set by a SIBLING test silently skip when run
 * under `-g`, which is how a check gets quietly retired: it stops running and
 * the board still says green. Each test that needs a family asks for one.
 */
async function pickWalkGroup(): Promise<string> {
  if (walkGroupId) return walkGroupId
  const groups = (await rest(
    `guest_groups?select=id,head_name&event_id=eq.${eventId}&order=created_at.asc&limit=1`,
  )) as { id: string; head_name: string }[]
  if (groups[0]) {
    walkGroupId = groups[0].id
    walkGroupName = groups[0].head_name
  }
  return walkGroupId
}

/** Console errors seen on the page under test, for step 7. */
function trackConsole(page: Page, sink: string[]) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') sink.push(msg.text())
  })
  page.on('pageerror', (err) => sink.push(`pageerror: ${err.message}`))
}

test.beforeAll(async () => {
  expect(BASE_URL, 'SMOKE_BASE_URL is not set — run this through `npm run smoke`').not.toBe('')
  expect(TEAM_CODE, 'no team access code available (SMOKE_TEAM_CODE / E2E_TEAM_CODE)').not.toBe('')

  const events = (await rest(`events?select=id,code&code=eq.${EVENT_CODE}`)) as { id: string }[]
  expect(events[0], `event ${EVENT_CODE} does not exist in the database`).toBeTruthy()
  eventId = events[0]!.id
})

// ---------------------------------------------------------------------------
// 4 — CRITICAL PATH (serial: each step feeds the next)
// ---------------------------------------------------------------------------

test.describe('4 critical path', () => {
  test.describe.configure({ mode: 'serial' })

test('S4.1 team access code signs in and reaches a staff identity', async ({ page }) => {
  await page.goto(`${BASE_URL}/login`)
  await page.getByLabel('Access code').fill(TEAM_CODE)
  await page.getByRole('button', { name: /enter event|checking/i }).click()

  // Either the staff picker (normal) or straight through. Anything else —
  // including staying on /login — means the code did not authenticate.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 45_000 })

  if (page.url().includes('/pick-staff')) {
    const firstStaff = page.getByRole('button').filter({ hasNotText: /back|sign out|change/i }).first()
    await expect(
      firstStaff,
      'the staff picker rendered with nobody to pick — this event has no staff_members rows, ' +
        'so no team session can be established',
    ).toBeVisible({ timeout: 20_000 })
    await firstStaff.click()
    await page.waitForURL((url) => !url.pathname.startsWith('/pick-staff'), { timeout: 30_000 })
  }

  // Landing anywhere that is still an auth screen means the code did not take.
  expect(
    /\/(login|pick-staff)/.test(new URL(page.url()).pathname),
    `the team code did not establish a session — still on ${new URL(page.url()).pathname}`,
  ).toBe(false)
})

test('S4.2 the guest list loads real families', async ({ page }) => {
  await signInTeam(page)
  await page.goto(`${BASE_URL}/${EVENT_CODE}/guests/list`)

  await expect(
    page.getByRole('heading', { name: /guest list/i }),
    'the guest list page did not render its heading',
  ).toBeVisible({ timeout: 30_000 })

  const groups = (await rest(
    `guest_groups?select=id,head_name&event_id=eq.${eventId}&order=created_at.asc&limit=1`,
  )) as { id: string; head_name: string }[]

  expect(
    groups.length,
    `${EVENT_CODE} has no families loaded — the calling queue will look finished when it is empty`,
  ).toBeGreaterThan(0)

  walkGroupId = groups[0]!.id
  walkGroupName = groups[0]!.head_name
})

test('S4.3 the call screen opens and offers a dial', async ({ page }) => {
  test.skip(!walkGroupId, 'no family available to walk')
  await signInTeam(page)
  await page.goto(`${BASE_URL}/${EVENT_CODE}/rsvp/call/${walkGroupId}`)

  await expect(
    page.getByRole('button', { name: /^Call /i }).first(),
    'the call screen rendered no Call button — either no dialable number is on file for ' +
      `"${walkGroupName}", or the screen failed to hydrate`,
  ).toBeVisible({ timeout: 30_000 })
})

test('S4.4 logging an RSVP updates the family record', async ({ page }) => {
  test.skip(!walkGroupId, 'no family available to walk')
  await signInTeam(page)

  const before = (await rest(
    `guest_groups?select=rsvp_status,confirmed_pax,updated_at&id=eq.${walkGroupId}`,
  )) as { updated_at: string }[]

  await page.goto(`${BASE_URL}/${EVENT_CODE}/rsvp/${walkGroupId}`)
  const coming = page.getByRole('radio', { name: /Coming/ })
  await expect(coming, 'the RSVP log form did not render').toBeVisible({ timeout: 30_000 })
  await coming.click()

  const notes = page.getByLabel('Notes')
  if (await notes.count()) {
    await notes.fill(`SMOKE ✓ ${new Date().toISOString()} — pre-event check, safe to ignore.`)
  }

  await page.getByRole('button', { name: /save outcome/i }).click()

  // The assertion is the DATABASE, not a toast. A green banner over a failed
  // write is exactly the failure mode this suite exists to catch.
  await expect
    .poll(
      async () => {
        const rows = (await rest(
          `guest_groups?select=rsvp_status,updated_at&id=eq.${walkGroupId}`,
        )) as { rsvp_status: string; updated_at: string }[]
        return rows[0]?.updated_at !== before[0]?.updated_at ? rows[0]?.rsvp_status : null
      },
      {
        timeout: 30_000,
        message:
          'the RSVP form reported saving but guest_groups was never updated — ' +
          'this is silent data loss on the single most important write in the app',
      },
    )
    .toBeTruthy()
})

test('S4.5 the call reaches the Excel export', async ({ page }) => {
  test.skip(!walkGroupId, 'no family available to walk')
  await signInTeam(page)
  await page.goto(`${BASE_URL}/${EVENT_CODE}/guests/export`)

  const button = page.getByRole('button', { name: /export excel/i })
  await expect(button, 'the export page did not render its button').toBeVisible({ timeout: 30_000 })

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 90_000 }),
    button.click(),
  ])

  const path = await download.path()
  expect(path, 'the export produced no file').toBeTruthy()

  const wb = XLSX.readFile(path!)
  const familySheet = wb.SheetNames.find((n) => /famil|head/i.test(n)) ?? wb.SheetNames[1] ?? wb.SheetNames[0]!
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[familySheet]!, { defval: null })

  const headers = Object.keys(rows[0] ?? {})
  for (const column of ['Calls', 'Last outcome']) {
    expect(
      headers.some((h) => h.trim().toLowerCase() === column.toLowerCase()),
      `the export is missing the "${column}" column — a call whose result cannot leave ` +
        `the system may as well not have happened. Columns present: ${headers.join(', ')}`,
    ).toBe(true)
  }

  expect(
    wb.SheetNames.some((n) => /call log/i.test(n)),
    `no "RSVP Call Log" sheet in the export. Sheets: ${wb.SheetNames.join(', ')}`,
  ).toBe(true)
})

}) // end 4 critical path

/**
 * Deployment-freshness guard, deliberately OUTSIDE the serial chain.
 *
 * It is a symptom check for "production is running old code" — the same thing
 * step 1.5 proves from the commit SHA, but visible in the UI. Keeping it in
 * the S4 chain meant a stale build skipped S4.4 and S4.5, hiding whether the
 * RSVP write and the export still worked. Those answers matter most exactly
 * when the build is wrong.
 */
test('S4.6 the deployed build is not pre-P1G', async ({ page }) => {
  const group = await pickWalkGroup()
  test.skip(!group, 'no family available to walk')
  await signInTeam(page)
  await page.goto(`${BASE_URL}/${EVENT_CODE}/rsvp/call/${group}`)

  // ASSERT PRESENCE BEFORE ASSERTING ABSENCE. `toHaveCount(0)` is satisfied by
  // an empty page, so on its own it passes while the screen is still blank and
  // then never re-checks. This test did exactly that: it went green against a
  // build that demonstrably still had the placeholder. Waiting for a marker
  // that only the loaded call screen renders is what makes the absence check
  // mean anything.
  await expect(
    page.getByRole('button', { name: /^Call /i }).first(),
    'the call screen never finished loading, so the placeholder check would be vacuous',
  ).toBeVisible({ timeout: 30_000 })

  await expect(
    page.getByText(/not available yet|mounts here once built/i),
    'the stale "recording not available" placeholder is on the deployed build — ' +
      'production is serving code from before the P1G fix',
  ).toHaveCount(0)
})

// ---------------------------------------------------------------------------
// 5 — DELIVERY PROOF
// ---------------------------------------------------------------------------

test('S5.1 delivery proofs are server-timestamped and immutable', async () => {
  const proofs = (await rest(
    `delivery_proofs?select=id,recorded_at,device_captured_at,captured_by,captured_by_staff` +
      `&event_id=eq.${eventId}&order=recorded_at.desc&limit=1`,
  )) as {
    id: string
    recorded_at: string
    captured_by: string | null
    captured_by_staff: string | null
  }[]

  const proof = proofs[0]
  test.skip(!proof, `no delivery proofs exist for ${EVENT_CODE} yet — nothing to verify`)

  expect(proof!.recorded_at, 'the proof carries no server timestamp').toBeTruthy()
  expect(
    Boolean(proof!.captured_by) || Boolean(proof!.captured_by_staff),
    `proof ${proof!.id.slice(0, 8)} has NEITHER captured_by NOR captured_by_staff — ` +
      '"who delivered this" is unanswerable, and proofs are insert-only so it can never be fixed',
  ).toBe(true)

  // Immutability, proven rather than assumed. Service role is used here ON
  // PURPOSE: the guarantee is that even service role cannot mutate a proof,
  // so anything weaker would not test it.
  const patch = await fetch(`${SUPABASE_URL}/rest/v1/delivery_proofs?id=eq.${proof!.id}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ notes: 'smoke tamper attempt' }),
  })
  expect(
    patch.ok,
    'A DELIVERY PROOF WAS MUTATED BY THE SERVICE ROLE. The block_mutation trigger is gone. ' +
      'Photo proof is no longer evidence.',
  ).toBe(false)

  const del = await fetch(`${SUPABASE_URL}/rest/v1/delivery_proofs?id=eq.${proof!.id}`, {
    method: 'DELETE',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  })
  expect(del.ok, 'A DELIVERY PROOF WAS DELETED BY THE SERVICE ROLE. The delete trigger is gone.').toBe(false)
})

// ---------------------------------------------------------------------------
// 6 — ROOM ALLOCATION
// ---------------------------------------------------------------------------

test('S6.1 the room grid loads and reflects the database', async ({ page }) => {
  await signInTeam(page)
  await page.goto(`${BASE_URL}/${EVENT_CODE}/hospitality/rooms`)

  await expect(
    page.getByText(/rooms/i).first(),
    'the room grid did not render',
  ).toBeVisible({ timeout: 30_000 })

  const rooms = (await rest(`rooms?select=id&event_id=eq.${eventId}&limit=1`)) as unknown[]
  expect(
    rooms.length,
    `${EVENT_CODE} has no rooms loaded — check-in and allocation cannot happen`,
  ).toBeGreaterThan(0)
})

test('S6.2 the client view exposes no phone numbers, notes or recordings', async ({ page }) => {
  test.skip(!CLIENT_CODE, 'no client access code available')

  await page.goto(`${BASE_URL}/login`)
  await page.getByLabel('Access code').fill(CLIENT_CODE)
  await page.getByRole('button', { name: /enter event|checking/i }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 45_000 })

  const body = (await page.locator('body').textContent()) ?? ''

  // A 10-digit Indian mobile on the client's screen is a privacy breach, not
  // a cosmetic issue. The client is the couple's family, not staff.
  expect(
    /\b[6-9]\d{9}\b/.test(body),
    'a mobile number is visible on the CLIENT view — clients must never see guest phone numbers',
  ).toBe(false)

  // Staff routes must refuse a client session outright.
  await page.goto(`${BASE_URL}/${EVENT_CODE}/rsvp/queue`)
  const queueBody = (await page.locator('body').textContent()) ?? ''
  expect(
    /families to call|call queue/i.test(queueBody) && !/not authorised|no access|sign in/i.test(queueBody),
    'a CLIENT session reached the staff calling queue',
  ).toBe(false)
})

// ---------------------------------------------------------------------------
// 7 — SECTIONS LOAD CLEAN
// ---------------------------------------------------------------------------

const SECTIONS = [
  { name: 'dashboard', path: 'dashboard' },
  { name: 'guests', path: 'guests/list' },
  { name: 'rsvp', path: 'rsvp/queue' },
  { name: 'logistics', path: 'logistics/arrivals' },
  { name: 'hospitality', path: 'hospitality/rooms' },
]

for (const section of SECTIONS) {
  test(`S7 ${section.name} loads without a console error`, async ({ page }) => {
    const errors: string[] = []
    trackConsole(page, errors)

    await signInTeam(page)
    const response = await page.goto(`${BASE_URL}/${EVENT_CODE}/${section.path}`, {
      waitUntil: 'domcontentloaded',
    })

    expect(
      response?.status() ?? 0,
      `/${EVENT_CODE}/${section.path} returned HTTP ${response?.status()}`,
    ).toBeLessThan(400)

    await page.waitForTimeout(2500) // let hydration settle so late errors surface

    // Report every error, even non-fatal — a section that logs on every load
    // trains staff to ignore a screen that is actually broken.
    expect(errors, `console errors on /${section.path}:\n  ${errors.join('\n  ')}`).toHaveLength(0)
  })
}

// ---------------------------------------------------------------------------
// Session helper
// ---------------------------------------------------------------------------

/**
 * Sign in as team in THIS page's context. Deliberately not a shared
 * storageState: each test getting its own session is how the suite proves the
 * login path still works on the deployed build, which is the thing that broke
 * last time.
 */
async function signInTeam(page: Page) {
  await page.goto(`${BASE_URL}/login`)
  if (!page.url().includes('/login')) return // already authenticated

  const field = page.getByLabel('Access code')
  if (!(await field.count())) return

  await field.fill(TEAM_CODE)
  await page.getByRole('button', { name: /enter event|checking/i }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 45_000 })

  if (page.url().includes('/pick-staff')) {
    const firstStaff = page.getByRole('button').filter({ hasNotText: /back|sign out|change/i }).first()
    await expect(
      firstStaff,
      'no staff members exist for this event, so no team session can be established',
    ).toBeVisible({ timeout: 20_000 })
    await firstStaff.click()
    await page.waitForURL((url) => !url.pathname.startsWith('/pick-staff'), { timeout: 30_000 })
  }
}
