import { expect, test, type Page } from '@playwright/test'

import { seed, unseed } from '../v12-seed.mjs'
import { FLOW_FAMILIES, FLOW_ROOMS, seedFlowFixtures } from './_seed'
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
 * (b) THE ROOMS JOB — get every family a bed, then fix the two cases the
 * engine cannot decide: move one guest, and pair two singles.
 *
 * ── THE ORDER OF THE THREE JOBS, AND WHY EACH RESETS THE FIXTURE ───────────
 *
 * The auto-fill job COMMITS room assignments for the very families the move
 * and share jobs act on. Run in one order the "share with another single" list
 * is empty because the single has already been placed; run in another it is
 * not. Each test therefore calls `seedFlowFixtures()` first, which deletes and
 * recreates only the `FLOW-` rows. That makes the order of the file irrelevant
 * and turns each tap count into a statement about one screen.
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

/** The Rooms board, reached by its own address (the tab itself is `(b0)`). */
async function roomsBoard(page: Page): Promise<void> {
  await open(page, session.code, 'hospitality/rooms')
  await page.getByRole('tablist', { name: 'Which list' }).waitFor({ state: 'visible', timeout: 30_000 })
}

/** Open the room sheet for a room number, from the By-room grid. */
async function openRoom(page: Page, roomNumber: string) {
  await tap(page, page.getByRole('tab', { name: /By room/ }), 'By room')
  const card = page.locator(`button[aria-label^="Room ${roomNumber},"]`).first()
  await tap(page, card, `Room ${roomNumber}`)
  const sheet = page.getByRole('dialog', { name: new RegExp(`Room ${roomNumber}`) })
  await sheet.waitFor({ state: 'visible', timeout: 20_000 })
  return sheet
}

test('(b0) the Rooms tab opens the Rooms board', async () => {
  // A tab whose href has no page behind it renders perfectly and 404s on tap,
  // so this is its own assertion: it names the fault instead of letting every
  // rooms spec report a missing element.
  await expectTabOpens(session.page, session.code, 'Rooms', /\/hospitality/)
})

test('(b1) auto-fill plans, is reviewed, and is confirmed', async () => {
  const page = session.page
  await seedFlowFixtures(session.eventId)
  await roomsBoard(page)

  await startCounting(page)

  // The screen's ONE primary. Its label counts the families waiting, which is
  // the thing being fixed.
  const autoFill = page.getByRole('button', { name: /^Auto-fill \d+ famil/ })
  await tap(page, autoFill, 'Auto-fill families')

  // The review takes over the screen. Nothing is written until Confirm.
  const confirm = page.getByRole('button', { name: /^Confirm \d+/ })
  await confirm.waitFor({ state: 'visible', timeout: 60_000 })
  await expect(page.getByText(/Nothing is saved yet/)).toBeVisible()

  await tap(page, confirm, 'Confirm')

  // The commit reports what it actually did, by name.
  await expect(page.getByText(/now have a bed/)).toBeVisible({ timeout: 60_000 })
  await expect(
    page.getByText('Nothing was saved.'),
    'the plan placed nobody — the allocator found no home for any waiting family',
  ).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)

  await finishCounting(page, 'rooms-autofill-confirm', 'plan → review → Confirm')
})

test('(b2) move one guest to another room', async () => {
  const page = session.page
  await seedFlowFixtures(session.eventId)
  await roomsBoard(page)

  const sheet = await openRoom(page, FLOW_ROOMS.share)
  await startCounting(page)

  // Tap the occupant, then the action the selection reveals.
  await tap(
    page,
    sheet.getByRole('button', { name: new RegExp(FLOW_FAMILIES.singleA) }).first(),
    FLOW_FAMILIES.singleA,
  )
  await tap(page, sheet.getByRole('button', { name: /^Move / }).first(), 'Move')

  // The target list, then the target.
  const target = sheet.getByRole('button', { name: new RegExp(`Room ${FLOW_ROOMS.moveTo}`) }).first()
  await target.waitFor({ state: 'visible', timeout: 20_000 })
  await tap(page, target, `Room ${FLOW_ROOMS.moveTo}`)

  // The write is DEFERRED, so the proof it is on its way is the Undo offer —
  // docs/UX-RULES.md R5. Waiting for the grid instead would race the timer.
  const undo = page.getByRole('button', { name: 'Undo' })
  await undo.waitFor({ state: 'visible', timeout: 30_000 })
  await expect(page.getByRole('status').filter({ hasText: /moved to room/ }).first()).toBeVisible()

  await finishCounting(page, 'rooms-move-guest', `${FLOW_FAMILIES.singleA} → room ${FLOW_ROOMS.moveTo}`)

  // The destination must now show one fewer free bed, read from the grid the
  // move patched.
  await expect(page.locator(`button[aria-label^="Room ${FLOW_ROOMS.moveTo},"]`).first()).toHaveAttribute(
    'aria-label',
    /1 of 2 beds/,
  )
})

test('(b3) pair two singles in one room', async () => {
  const page = session.page
  await seedFlowFixtures(session.eventId)
  await roomsBoard(page)

  const sheet = await openRoom(page, FLOW_ROOMS.share)
  await startCounting(page)

  // Offered only because the room holds exactly one single and has a free bed.
  await tap(
    page,
    sheet.getByRole('button', { name: 'Share with another single' }),
    'Share with another single',
  )
  const partner = sheet
    .getByRole('button', { name: new RegExp(FLOW_FAMILIES.singleB) })
    .first()
  await expect(
    partner,
    'no single on the same side is waiting for a room, so the pairing cannot be made at all',
  ).toBeVisible({ timeout: 20_000 })
  await tap(page, partner, FLOW_FAMILIES.singleB)

  const undo = page.getByRole('button', { name: 'Undo' })
  await undo.waitFor({ state: 'visible', timeout: 30_000 })

  await finishCounting(page, 'rooms-share-two-singles', `${FLOW_FAMILIES.singleB} added to ${FLOW_ROOMS.share}`)

  await expect(page.locator(`button[aria-label^="Room ${FLOW_ROOMS.share},"]`).first()).toHaveAttribute(
    'aria-label',
    /2 of 2 beds/,
  )
})
