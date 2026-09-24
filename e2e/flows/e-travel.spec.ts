import { expect, test, type Page } from '@playwright/test'

import { FAMILIES, seed, unseed } from '../v12-seed.mjs'
import { FLOW_FAMILIES, seedFlowFixtures } from './_seed'
import {
  expectTabOpens,
  finishCounting,
  open,
  openSession,
  startCounting,
  tap,
  type FlowSession,
} from './_lib'

/**
 * (e) TRAVEL — meet an arrival, and record a departure nobody called about.
 *
 * The board is one component serving both directions behind a two-option
 * `Segmented`, and there is a specific reason this spec drives the SWITCH
 * rather than loading each address directly: both directions share ONE
 * TanStack cache key (`queryKeys.logistics.arrivals`), so tapping the switch
 * inside the 30-second stale window serves the other direction's cached rows.
 * `(e2)` is that regression, stated as a fact about the screen: a family whose
 * only leg is an arrival must never appear on the departures board.
 */

test.describe.configure({ mode: 'serial' })

let session: FlowSession

test.beforeAll(async ({ browser }) => {
  session = await openSession(browser, 'team')
  await seed()
  await seedFlowFixtures(session.eventId)
})

test.afterAll(async () => {
  await unseed().catch(() => {})
  await session?.context.close()
})

/** The family the Now card is currently naming, from its one line of context. */
async function nowCardFamily(page: Page): Promise<string> {
  const context = page.locator('section.bg-now p').nth(1)
  await context.waitFor({ state: 'visible', timeout: 30_000 })
  const text = (await context.textContent())?.trim() ?? ''
  const name = text.split(' · ')[0]?.trim() ?? ''
  expect(name, `the Now card's context line names nobody: "${text}"`).not.toBe('')
  return name
}

test('(e0) the Travel tab opens the Travel board', async () => {
  await expectTabOpens(session.page, session.code, 'Travel', /\/logistics/)
})

test('(e1) mark the next arrival met', async () => {
  const page = session.page
  await open(page, session.code, 'logistics/arrivals')
  await expect(page.getByText(/Arrivals met/)).toBeVisible({ timeout: 30_000 })

  const mark = page.getByRole('button', { name: 'Mark arrived' }).first()
  await mark.waitFor({ state: 'visible', timeout: 30_000 })
  const name = await nowCardFamily(page)

  await startCounting(page)
  // ONE tap opens the family's sheet; the commit lives in the sheet, which is
  // where SPEC-V3 §2 wants detail and edits to be.
  await tap(page, mark, 'Mark arrived')

  const sheet = page.getByRole('dialog', { name: new RegExp(`${name} — travel`) })
  await sheet.waitFor({ state: 'visible', timeout: 20_000 })
  await tap(page, sheet.getByRole('button', { name: 'Mark arrived' }), 'Mark arrived (sheet)')

  // Deferred write: the Undo offer is the proof it is on its way.
  await page.getByRole('button', { name: 'Undo' }).waitFor({ state: 'visible', timeout: 30_000 })
  await expect(page.getByRole('status').filter({ hasText: /Arrived/ }).first()).toBeVisible()

  await finishCounting(page, 'arrival-met', `${name} marked arrived`)

  // In the UI, that family's row now reads "Met" rather than "Expected".
  const row = page.getByRole('button', { name: new RegExp(escapeRe(name)) }).first()
  await expect(row, 'the arrival still does not read "Met"').toContainText('Met')
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('(e2) the Arrivals|Departures switch shows departures, not arrivals', async () => {
  const page = session.page
  await open(page, session.code, 'logistics/arrivals')
  await expect(page.getByText(/Arrivals met/)).toBeVisible({ timeout: 30_000 })

  // Within the stale window, which is when a runner actually taps it.
  await tap(page, page.getByRole('tab', { name: 'Departures' }), 'Departures')
  await page.waitForURL(/\/logistics\/departures/, { timeout: 30_000 })

  await expect(page.getByText(/Departures gone/)).toBeVisible({ timeout: 30_000 })

  // `FAMILIES.arrival` has an ARRIVAL leg and no departure leg. If it appears
  // here, the board is painting the arrival query's cached rows — and "Mark
  // departed" would stamp `departed_at` on a family that has not left.
  const arrivalOnly = page.getByText(FAMILIES.arrival)
  await expect(
    arrivalOnly,
    `${FAMILIES.arrival} has no departure leg, so it must not be on the departures board — ` +
      `if it is here, the two directions are sharing one cache entry`,
  ).toHaveCount(0)
})

test('(e3) a walk-up search that matches nobody says so', async () => {
  const page = session.page
  await open(page, session.code, 'logistics/departures/new')

  const search = page.getByPlaceholder('Search by name or room number')
  await search.waitFor({ state: 'visible', timeout: 30_000 })
  await search.fill('Nobody Called This')

  await tap(page, page.getByRole('button', { name: 'Search' }), 'Search')

  // The honest answers are a no-match sentence or an error sentence. What must
  // NOT happen is the search box coming back empty with no word about it: a
  // runner cannot tell that from a tap that never registered.
  await expect(
    page.getByText(/No family matches|no family called|Nothing matches|Search failed|Could not/i),
    'the search matched nobody and the screen said nothing — it looks like the tap did not register',
  ).toBeVisible({ timeout: 20_000 })
})

test('(e4) record a walk-up departure', async () => {
  const page = session.page
  // Recorded through the walk-up form's own address. The LINK to it lives only
  // inside the departures board's EMPTY state, so on an event with any
  // departure on file there is no way to reach this screen by tapping — see
  // docs/BUGS.md.
  await open(page, session.code, 'logistics/departures/new')

  const search = page.getByPlaceholder('Search by name or room number')
  await search.waitFor({ state: 'visible', timeout: 30_000 })
  await search.fill(FLOW_FAMILIES.walkup)

  await startCounting(page)
  await tap(page, page.getByRole('button', { name: 'Search' }), 'Search')

  // One match opens the form directly, which is the flow's whole economy.
  await expect(page.getByText('Record a walk-up departure')).toBeVisible({ timeout: 30_000 })
  const date = page.locator('input[type="date"]')
  await expect(date, 'the form did not open for the single match').toBeVisible({ timeout: 20_000 })

  const today = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  await date.fill(`${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`)
  await page.locator('input[type="time"]').fill('18:30')
  await page.locator('input[type="number"]').first().fill('2')

  await tap(page, page.getByRole('button', { name: 'Save departure' }), 'Save departure')

  // Saved, and the screen offers the next step rather than leaving the runner
  // on a form that looks unchanged.
  await expect(page.getByRole('button', { name: 'Saved' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('link', { name: /Arrange a vehicle/ })).toBeVisible()

  await finishCounting(page, 'departure-walkup', `${FLOW_FAMILIES.walkup} departing 18:30, 2 guests`)
})

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
