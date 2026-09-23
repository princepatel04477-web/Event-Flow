import { expect, test, type Page } from '@playwright/test'

import { FAMILIES, ROOM_NUMBER, seed, unseed } from '../v12-seed.mjs'
import { finishCounting, headerSearch, open, openSession, startCounting, tap, type FlowSession } from './_lib'

/**
 * (f) GUEST SEARCH — by name, by the last four digits of the mobile, and by room.
 *
 * Find is the search button in every header, and it is now the ONLY way to
 * reach the guest list (Guests is not a tab in v3). The screen promises all
 * three ways in, in its own placeholder — "Name, last 4 digits, or room" — so
 * this spec holds it to all three rather than to the one that happens to work.
 *
 * The last-four path is the one worth guarding: a family head answers the
 * phone, the caller writes down "…0011", and the only way back to the family
 * is a search that matches the tail of a number. The room path is what a
 * coordinator standing at a door uses when a guest's name is the thing they
 * do not have.
 *
 * Typing is NOT a tap. One tap opens the header's search button, one tap puts
 * the cursor in the box, and the characters are free — which is the whole
 * reason a tap budget is a statement about the screen rather than about the
 * keyboard.
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

/** Land on Find through the header button, and type the term. */
async function searchFor(page: Page, term: string) {
  await open(page, session.code)
  const button = headerSearch(page)
  await button.waitFor({ state: 'visible', timeout: 30_000 })
  await tap(page, button, 'Find a guest')
  await page.waitForURL(/\/find$/, { timeout: 30_000 })

  const field = page.getByPlaceholder('Name, last 4 digits, or room')
  await field.waitFor({ state: 'visible', timeout: 30_000 })
  await tap(page, field, 'search field')
  await field.fill(term)
  // The field debounces at 250ms; the results below are the assertion.
}

test('(f0) the guest list is reachable by name', async () => {
  const page = session.page
  await startCounting(page)
  await searchFor(page, 'Sharma')

  const results = page.getByRole('list', { name: 'Search results' })
  await expect(results, 'a name search returned nothing').toBeVisible({ timeout: 30_000 })
  await expect(results.getByText(FAMILIES.search)).toBeVisible({ timeout: 30_000 })

  await finishCounting(page, 'find-guest', `typed "Sharma" → ${FAMILIES.search}`)
})

test('(f1) the last four digits of a mobile find the family', async () => {
  const page = session.page
  // The seeded search family's number is 9811100011, so 0011 is its tail.
  await searchFor(page, '0011')

  const results = page.getByRole('list', { name: 'Search results' })
  await expect(
    results.getByText(FAMILIES.search),
    'the last four digits of a stored mobile did not find the family — ' +
      'the one thing a caller writes down is the tail of the number',
  ).toBeVisible({ timeout: 30_000 })
})

test('(f2) a room number finds the guest in that room', async () => {
  const page = session.page
  await searchFor(page, ROOM_NUMBER)

  const results = page.getByRole('list', { name: 'Search results' })
  await expect(results, 'a room search returned nothing').toBeVisible({ timeout: 30_000 })
  await expect(
    results.getByText(new RegExp(`Room ${ROOM_NUMBER}`)),
    `searching "${ROOM_NUMBER}" did not find anyone in that room`,
  ).toBeVisible({ timeout: 30_000 })
})

test('(f3) tapping a result opens the guest sheet', async () => {
  const page = session.page
  await searchFor(page, 'Sharma')

  const row = page
    .getByRole('list', { name: 'Search results' })
    .getByRole('button', { name: new RegExp(FAMILIES.search) })
    .first()
  await row.waitFor({ state: 'visible', timeout: 30_000 })
  await tap(page, row, FAMILIES.search)

  const sheet = page.getByRole('dialog', { name: /guest details$/ })
  await expect(sheet, 'tapping a search result opened nothing').toBeVisible({ timeout: 20_000 })
  // The sheet answers the question the search exists for: who is this, and
  // where are they sleeping.
  await expect(sheet.getByText('Stay')).toBeVisible()
  await expect(sheet.getByText('Hamper')).toBeVisible()
})

test('(f4) a search that matches nothing says so', async () => {
  const page = session.page
  await searchFor(page, 'Zzzz Nobody')

  await expect(
    page.getByText(/Nothing matches/),
    'a search with no results left the screen blank — indistinguishable from a dead tap',
  ).toBeVisible({ timeout: 20_000 })
})
