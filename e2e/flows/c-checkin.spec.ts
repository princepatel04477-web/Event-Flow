import { expect, test } from '@playwright/test'

import { seed, unseed } from '../v12-seed.mjs'
import { FLOW_FAMILIES, seedFlowFixtures } from './_seed'
import { finishCounting, open, openSession, startCounting, tap, type FlowSession } from './_lib'

/**
 * (c) CHECK A FAMILY IN — the desk job.
 *
 * A family walks up, you find them, you tap once. The screen is a progress bar,
 * a search and rows, and every write is one tap inside the family's sheet.
 *
 * ── THE BUTTON'S LABEL IS A FINDING, NOT A TYPO ────────────────────────────
 *
 * `CheckInClient` renders the primary as `Checked in` — a past-tense STATUS on
 * the one control that performs the action, directly under a heading that
 * already shows the same words. A first-day runner reading "Checked in" cannot
 * tell whether the family is already checked in or whether tapping will check
 * them in. It is recorded in `docs/BUGS.md`; the locator below accepts either
 * wording so that fixing the copy does not break this spec, and the assertion
 * on the row's status word is what proves the state actually changed.
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

test('(c) check a family in, from the check-in board', async () => {
  const page = session.page
  await seedFlowFixtures(session.eventId)

  await open(page, session.code, 'hospitality/checkin')
  await expect(page.getByText(/Families arrived/)).toBeVisible({ timeout: 30_000 })

  // Find the family the way the desk does — by typing, which is not a tap.
  const search = page.getByPlaceholder('Search a family or a room')
  await search.waitFor({ state: 'visible', timeout: 20_000 })
  await search.fill(FLOW_FAMILIES.checkin)

  const row = page.getByRole('button', { name: new RegExp(FLOW_FAMILIES.checkin) }).first()
  await expect(row, 'the family with a bed is not on the check-in board').toBeVisible({
    timeout: 20_000,
  })

  await startCounting(page)
  await tap(page, row, FLOW_FAMILIES.checkin)

  const sheet = page.getByRole('dialog', { name: FLOW_FAMILIES.checkin })
  await sheet.waitFor({ state: 'visible', timeout: 20_000 })

  // Accept either the shipped label or the corrected one — see the file header.
  await tap(page, sheet.getByRole('button', { name: /^Check(ed)? in$/ }), 'check in')

  // The write is DEFERRED (neither RPC has a reverse, so Undo must mean
  // NOTHING WAS SENT), so the offer to undo is the proof it is on its way.
  await page.getByRole('button', { name: 'Undo' }).waitFor({ state: 'visible', timeout: 30_000 })

  await finishCounting(page, 'checkin-a-family', `${FLOW_FAMILIES.checkin} checked in`)

  // The outcome, in the UI: the row's own status word is now "In".
  const afterRow = page.getByRole('button', { name: new RegExp(FLOW_FAMILIES.checkin) }).first()
  await expect(afterRow, 'the row still does not read "In" after checking in').toContainText('In')
  await expect(page.getByRole('alert')).toHaveCount(0)
})
