import { expect, test, type Page } from '@playwright/test'

import { FAMILIES, seed, unseed } from '../v12-seed.mjs'
import {
  expectTabOpens,
  finishCounting,
  notFoundNote,
  open,
  openSession,
  startCounting,
  tap,
  tapTab,
  type FlowSession,
} from './_lib'

/**
 * (a) THE CALLER'S JOB — the whole shift, in the order it is worked.
 *
 *   1. Call the next family.
 *   2. Log "Coming", with 4 adults, a date and a train — and see it saved.
 *   3. Log "Call back" with a time.
 *   4. Log "No answer".
 *
 * ── WHY THE OUTCOMES ARE LOGGED ON ONE FAMILY AND THE TAP BUDGETS ARE NOT ──
 *
 * Steps 2–4 each re-select the SAME seeded family through "See all families →
 * All → <name>", and `startCounting` runs AFTER that selection. Two reasons,
 * both load-bearing:
 *
 *  - The queue is ordered `attempt_count asc, last_attempt_at asc nulls first,
 *    priority desc, head_name asc`, and `attempt_count` is `count(*)` over
 *    `call_attempts` — append-only, so it can never be reset. A spec that
 *    re-ran against "the head of the queue" would act on a different family
 *    every time and could not assert anything about a named one.
 *  - Selecting a family is navigation, not the job. Charging its three taps to
 *    "log the outcome" would make the budget a statement about the queue's
 *    ordering rather than about the outcome buttons.
 *
 * The family is the one `e2e/v12-seed.mjs` creates and names `0 V12-Call Next`
 * — the leading `0 ` is what makes it sort to the head of the calling list, so
 * step 1 can be measured as "the next family" without selecting anything.
 *
 * ── WHAT PROVES THE WRITE, WHEN THE UI ONLY SAYS "MOVED ON" ────────────────
 *
 * A saved outcome's only immediate UI signal is that the card advances. That
 * is not enough to call it saved, so the readback test re-opens the family
 * filter, finds the family under the status that was just recorded, and reads
 * the head count the screen now shows for it ("4 invited", from
 * `confirmed_pax`, which the save wrote). That is a read of the database's
 * answer through the UI, not a read of the optimistic patch: the patch lands on
 * the QUEUE cache entry, while the count on a sheet row comes from the row the
 * save returned.
 */

test.describe.configure({ mode: 'serial' })

let session: FlowSession

test.beforeAll(async ({ browser }) => {
  session = await openSession(browser, 'team')
  await seed()
})

test.afterAll(async () => {
  await unseed().catch(() => {})
  await session?.context.close()
})

/** The family on the card, by the name the card shows. */
async function cardFamily(page: Page): Promise<string> {
  const heading = page.locator('section[aria-label^="Current family:"] h2').first()
  await heading.waitFor({ state: 'visible', timeout: 30_000 })
  const name = (await heading.textContent())?.trim() ?? ''
  expect(name, 'the family card is showing no name').not.toBe('')
  return name
}

/** Every outcome control is disabled when the family's details did not load. */
async function outcome(page: Page, label: string) {
  return page.getByRole('button', { name: label, exact: true })
}

/**
 * Put a NAMED family on the card, through the queue sheet.
 *
 * Not part of any measured job — see the file header.
 */
async function selectFamily(page: Page, name: string): Promise<void> {
  await tap(page, page.getByRole('button', { name: /See all families/ }).first(), 'See all families')
  const sheet = page.getByRole('dialog', { name: 'All families' })
  await sheet.waitFor({ state: 'visible', timeout: 20_000 })
  await tap(
    page,
    sheet.locator('[role="group"][aria-label="Filter queue"] button', { hasText: 'All' }).first(),
    'All filter',
  )
  await tap(page, sheet.getByRole('button', { name: new RegExp(escapeRe(name)) }).first(), name)
  await sheet.waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {})
  expect(await cardFamily(page)).toContain(name.replace(/^0 /, ''))
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Drive a Stepper to an exact value by tapping its own buttons.
 *
 * Reads the value out of the live `role="status"` readout and taps + or −
 * until it matches, rather than counting from an assumed starting point: the
 * starting point is `family.adults_confirmed ?? expected_pax`, and a spec that
 * assumed it would silently skip taps on a re-run and quietly measure a
 * shorter job.
 */
async function setStepper(page: Page, label: string, target: number): Promise<number> {
  const group = page.locator(`[role="group"][aria-label="${label}"]`).first()
  await group.waitFor({ state: 'visible', timeout: 20_000 })
  const readout = group.locator('[role="status"]').first()

  let taps = 0
  for (let i = 0; i < 12; i += 1) {
    const current = Number((await readout.textContent())?.trim() ?? 'NaN')
    if (current === target) return taps
    const name = current < target ? `Increase ${label}` : `Decrease ${label}`
    await tap(page, page.getByRole('button', { name, exact: true }), name)
    taps += 1
  }
  throw new Error(`could not drive the "${label}" stepper to ${target}`)
}

test('(a0) the Calls tab opens the calling screen', async () => {
  await expectTabOpens(session.page, session.code, 'Calls', /\/rsvp/)
})

test('(a1) call the next family', async () => {
  const page = session.page
  await open(page, session.code)
  await tapTab(page, 'Calls')

  // The card must be the family the seed put at the head, or the measured job
  // is "tap a dial button for whoever happens to be first".
  const name = await cardFamily(page)
  expect(name, `the head of the calling list is "${name}", not the seeded family`).toContain(
    FAMILIES.call.replace(/^0 /, ''),
  )

  const dial = page.getByRole('button', { name: /^Call / }).first()
  await expect(
    await dial.isEnabled(),
    `"${name}" has no dialable number, so nobody can call it — a data problem, not a screen problem`,
  ).toBe(true)

  await startCounting(page)
  await tap(page, dial, 'Call')
  // The row is written BEFORE `tel:` fires (the WebView is backgrounded by the
  // dialer), so the screen's own evidence of the tap is the in-flight label.
  await page
    .locator('body')
    .filter({ hasText: /Logging the call|Could not|No connection|No phone number/ })
    .first()
    .waitFor({ state: 'attached', timeout: 30_000 })

  await finishCounting(page, 'call-next-family', `dialled ${name}`)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('(a2) Coming, with 4 adults and a train, is saved', async () => {
  const page = session.page
  await open(page, session.code)
  await tapTab(page, 'Calls')
  await selectFamily(page, FAMILIES.call)
  const name = await cardFamily(page)

  await startCounting(page)

  await tap(page, await outcome(page, 'Coming'), 'Coming')
  await expect(page.getByRole('region', { name: 'Capture RSVP travel details' })).toBeVisible({
    timeout: 20_000,
  })

  await setStepper(page, 'Adults', 4)

  // A date, from the chips the event's own window produces.
  await tap(
    page,
    page.locator('[role="group"][aria-label="Arrival date options"] button').first(),
    'arrival date chip',
  )
  // A time of day, from the four slots.
  await tap(
    page,
    page.locator('[role="group"][aria-label="Arrival time of day"] button').first(),
    'arrival time chip',
  )
  // The mode, from the tiles.
  await tap(
    page,
    page.locator('[role="group"][aria-label="Travel mode"] button', { hasText: 'Train' }).first(),
    'Train',
  )
  await page.getByLabel(/Train no\./).fill('12951')

  await tap(page, page.getByRole('button', { name: 'Save · next family' }), 'Save · next family')

  // The outcome landed if the card moved off the family just logged.
  await expect
    .poll(async () => cardFamily(page).catch(() => ''), {
      timeout: 30_000,
      message: 'the card did not advance after saving — the save may not have landed',
    })
    .not.toContain(name.replace(/^0 /, ''))
  await expect(page.getByRole('alert')).toHaveCount(0)

  await finishCounting(page, 'coming-with-travel', `${name} · Coming · 4 adults · train 12951`)
})

test('(a3) the saved head count and status read back from the database', async () => {
  const page = session.page
  await open(page, session.code)
  await tapTab(page, 'Calls')

  // Readback through the same sheet a caller uses, under the status that was
  // just written. This is the assertion that "saved" is true, and it reads the
  // row the save came back with rather than the optimistic patch.
  await tap(page, page.getByRole('button', { name: /See all families/ }).first(), 'See all families')
  const sheet = page.getByRole('dialog', { name: 'All families' })
  await sheet.waitFor({ state: 'visible', timeout: 20_000 })
  await tap(
    page,
    sheet.locator('[role="group"][aria-label="Filter queue"] button', { hasText: 'Coming' }).first(),
    'Coming filter',
  )

  const row = sheet.getByRole('button', { name: new RegExp(escapeRe(FAMILIES.call)) }).first()
  await expect(row, 'the family saved as Coming is not under the Coming filter').toBeVisible({
    timeout: 20_000,
  })
  await expect(row, 'the saved head count is not 4 — the count did not land').toContainText(
    '4 invited',
  )
})

test('(a4) Call back, with a time', async () => {
  const page = session.page
  await open(page, session.code)
  await tapTab(page, 'Calls')
  await selectFamily(page, FAMILIES.call)
  const name = await cardFamily(page)

  await startCounting(page)
  await tap(page, page.getByRole('button', { name: /Call back later or Maybe/ }), 'Call back / Maybe')

  const sheet = page.getByRole('dialog', { name: 'Call back or maybe' })
  await sheet.waitFor({ state: 'visible', timeout: 20_000 })
  await tap(page, sheet.getByRole('button', { name: '1 hour' }).first(), '1 hour chip')
  await tap(page, sheet.getByRole('button', { name: 'Save call back' }), 'Save call back')

  await expect(sheet, 'the call-back sheet did not close — the save did not land').toBeHidden({
    timeout: 20_000,
  })
  await expect(page.getByRole('alert')).toHaveCount(0)
  await finishCounting(page, 'call-back', `${name} · Call back in 1 hour`)
})

test('(a5) No answer', async () => {
  const page = session.page
  await open(page, session.code)
  await tapTab(page, 'Calls')
  await selectFamily(page, FAMILIES.call)
  const name = await cardFamily(page)

  await startCounting(page)
  await tap(page, await outcome(page, 'No answer'), 'No answer')

  await expect
    .poll(async () => cardFamily(page).catch(() => ''), {
      timeout: 30_000,
      message: 'the card did not advance after "No answer" — the outcome did not land',
    })
    .not.toContain(name.replace(/^0 /, ''))
  await expect(page.getByRole('alert')).toHaveCount(0)
  await finishCounting(page, 'log-outcome-one-tap', `${name} · No answer`)

  // A dead end is a bug (UX R3): with the last family handled the screen must
  // say so and offer the way to the full list, not render nothing.
  const empty = page.getByText(/That's everyone|No families here/)
  const stillWorking = page.locator('section[aria-label^="Current family:"]')
  await expect
    .poll(async () => (await empty.count()) + (await stillWorking.count()), { timeout: 20_000 })
    .toBeGreaterThan(0)
  expect(await notFoundNote(page).count()).toBe(0)
})
