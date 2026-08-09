import { test, expect } from '@playwright/test'

import { loadTestEnv } from './helpers/env'

/**
 * Per-request identity isolation.
 *
 * WHY THIS EXISTS. Staff routes resolve identity twice per navigation (layout
 * for the nav, page for the gate), so those reads are now memoised per request
 * via `lib/request-cache.ts`. Memoising identity is exactly the change that
 * broke this app before: an earlier `cache()` attempt leaked memoised nulls
 * across requests and was reverted. Any future edit to that file must keep
 * this test green.
 *
 * WHAT IT PROVES. Two DIFFERENT sessions issuing overlapping, concurrent
 * requests to the same route never see each other's identity. The tell is the
 * admin-only link in the sticky header: it renders from
 * `effectiveViewer.isAdmin`, which comes from the memoised viewer. If one
 * request's identity bled into another, a team response would carry the admin
 * link (or an admin response would lose it).
 *
 * Requests are interleaved rather than run in two clean batches, because a
 * cross-request leak only shows when two identities are in flight at once.
 */

const env = loadTestEnv()

/** How many overlapping request pairs to fire. */
const ROUNDS = 12

test('identity cannot leak between concurrent requests with different sessions', async ({
  browser,
}) => {
  test.setTimeout(180_000)

  // --- admin session -------------------------------------------------------
  const adminCtx = await browser.newContext()
  const adminPage = await adminCtx.newPage()
  await adminPage.goto('/admin/login')
  await adminPage.getByLabel('Email').fill(env.E2E_USER_A_EMAIL)
  await adminPage.getByLabel('Password').fill(env.E2E_USER_A_PASSWORD)
  await adminPage.getByRole('button', { name: /sign in|enter event/i }).click()
  await adminPage.waitForURL((u) => !u.pathname.startsWith('/admin/login'), { timeout: 30_000 })

  // --- team session --------------------------------------------------------
  const teamCtx = await browser.newContext()
  const teamPage = await teamCtx.newPage()
  await teamPage.goto('/login')
  await teamPage.getByLabel('Access code').fill(env.E2E_TEAM_CODE)
  await teamPage.getByRole('button', { name: /enter event|checking/i }).click()
  await teamPage.waitForURL(/\/pick-staff/, { timeout: 30_000 })
  await teamPage.getByRole('button', { name: env.E2E_TEAM_STAFF, exact: false }).first().click()
  await teamPage.waitForURL((u) => !u.pathname.startsWith('/pick-staff'), { timeout: 30_000 })

  // The team session's own event — the admin can reach it too, so both
  // sessions hit the SAME url and any difference in the response is identity,
  // not routing.
  const code = new URL(teamPage.url()).pathname.split('/').filter(Boolean)[0]
  expect(code, 'team login must land on an event').toBeTruthy()
  const target = `/${code}`

  // Fetch inside each browser context so the request carries that context's
  // cookies, and `?cb=` so nothing is served from a cache.
  const fetchAs = async (page: typeof adminPage, tag: string, round: number) =>
    page.evaluate(
      async ([url, t, r]) => {
        const res = await fetch(`${url}?cb=${t}-${r}-${Date.now()}`, {
          headers: { accept: 'text/html' },
        })
        return { status: res.status, html: await res.text() }
      },
      [target, tag, String(round)] as const,
    )

  const adminMarks: boolean[] = []
  const teamMarks: boolean[] = []

  for (let round = 0; round < ROUNDS; round += 1) {
    // Both in flight at the same time — that overlap is the whole point.
    const [adminRes, teamRes] = await Promise.all([
      fetchAs(adminPage, 'admin', round),
      fetchAs(teamPage, 'team', round),
    ])

    expect(adminRes.status, `admin round ${round}`).toBe(200)
    expect(teamRes.status, `team round ${round}`).toBe(200)

    // The admin-only header link (components/nav/AdminLink.tsx), matched on
    // its aria-label. NOT on href="/admin" — the link actually points at
    // /admin/events, and that near-miss made this assertion report a leak in
    // 12/12 rounds when there was none.
    const adminLink = /aria-label="Admin"/
    adminMarks.push(adminLink.test(adminRes.html))
    teamMarks.push(adminLink.test(teamRes.html))
  }

  // Every admin response must look like an admin; every team response must
  // not. A single crossover in either direction is the leak.
  expect(
    adminMarks.filter(Boolean).length,
    `admin lost its identity in ${adminMarks.filter((m) => !m).length}/${ROUNDS} concurrent rounds`,
  ).toBe(ROUNDS)

  expect(
    teamMarks.filter(Boolean).length,
    `team saw ADMIN identity in ${teamMarks.filter(Boolean).length}/${ROUNDS} concurrent rounds`,
  ).toBe(0)

  await adminCtx.close()
  await teamCtx.close()
})

/**
 * The other half of the reverted bug: a memoised NULL becoming sticky.
 *
 * An anonymous request must be bounced every time. If "no session" were ever
 * cached and reused, an authenticated request landing on the same worker could
 * inherit it — or, as happened before, a transient null could pin a signed-in
 * user to /login for the rest of the request.
 */
test('an anonymous request is bounced every time, never served a cached identity', async ({
  browser,
}) => {
  test.setTimeout(120_000)

  const teamCtx = await browser.newContext()
  const teamPage = await teamCtx.newPage()
  await teamPage.goto('/login')
  await teamPage.getByLabel('Access code').fill(env.E2E_TEAM_CODE)
  await teamPage.getByRole('button', { name: /enter event|checking/i }).click()
  await teamPage.waitForURL(/\/pick-staff/, { timeout: 30_000 })
  await teamPage.getByRole('button', { name: env.E2E_TEAM_STAFF, exact: false }).first().click()
  await teamPage.waitForURL((u) => !u.pathname.startsWith('/pick-staff'), { timeout: 30_000 })
  const code = new URL(teamPage.url()).pathname.split('/').filter(Boolean)[0]

  const anonCtx = await browser.newContext()
  const anonPage = await anonCtx.newPage()

  for (let round = 0; round < 6; round += 1) {
    // Anonymous and authenticated, overlapping.
    const [anonUrl, teamOk] = await Promise.all([
      anonPage
        .goto(`/${code}?cb=anon-${round}-${Date.now()}`, { waitUntil: 'domcontentloaded' })
        .then(() => anonPage.url()),
      teamPage
        .goto(`/${code}?cb=team-${round}-${Date.now()}`, { waitUntil: 'domcontentloaded' })
        .then(() => teamPage.url()),
    ])

    expect(anonUrl, `anonymous round ${round} must be sent to /login`).toContain('/login')
    expect(teamOk, `team round ${round} must stay on the event`).toContain(`/${code}`)
    expect(teamOk, `team round ${round} must not be bounced`).not.toContain('/login')
  }

  await anonCtx.close()
  await teamCtx.close()
})
