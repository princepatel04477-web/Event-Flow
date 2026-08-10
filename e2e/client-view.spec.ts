import { expect, test } from '@playwright/test'

import { loggedInContext, loginClient } from './helpers/auth'

/**
 * The client screen — the one page a `client` login can reach.
 *
 * REGRESSION THIS EXISTS FOR: `/[eventCode]/guests` once called
 * `requireStaff`, which redirects a client to `/{eventCode}/guests` — the
 * page they were already on. The client's only screen bounced them at
 * itself, and the loop surfaced as the event error boundary ("This screen
 * did not load"). Nothing else in the app catches that: every other guard
 * redirects somewhere the caller is allowed to be.
 *
 * The second half is data, not routing. A client reads zero rows from
 * `search_guest_profiles` (it runs as the invoker), so pointing this screen
 * at the staff source renders a confident "No guest details yet" on a
 * wedding with hundreds of families. Asserting a guest is actually on the
 * page is what tells those two apart.
 */
test.describe('client view', () => {
  let clientState: string

  test.beforeAll(async ({ browser }) => {
    clientState = await loginClient(browser)
  })

  test('C1 lands on the guest list, not the error boundary', async ({ browser }) => {
    const { context, page } = await loggedInContext(browser, clientState)

    await page.goto('/')
    await page.waitForURL(/\/guests$/, { timeout: 30_000 })

    await expect(page.getByText('This screen did not load')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Guest list' })).toBeVisible()

    await context.close()
  })

  test('C2 renders guests from client_guest_profiles', async ({ browser }) => {
    const { context, page } = await loggedInContext(browser, clientState)

    await page.goto('/')
    await page.waitForURL(/\/guests$/, { timeout: 30_000 })

    // The count line is the screen's own claim about what it read. A client
    // pointed at the staff source reaches this line saying nothing.
    await expect(page.getByText(/\d+ guests · \d+ families/)).toBeVisible({ timeout: 20_000 })

    // At least one card actually mounted — the count could be right while
    // the list below it is empty.
    await expect(page.getByRole('article').first()).toBeVisible()

    await context.close()
  })

  test('C3 gives a client no navigation out of it', async ({ browser }) => {
    const { context, page } = await loggedInContext(browser, clientState)

    await page.goto('/')
    await page.waitForURL(/\/guests$/, { timeout: 30_000 })
    await expect(page.getByRole('article').first()).toBeVisible({ timeout: 20_000 })

    // No tab bar (BottomTabs returns null for `client`), and no card links
    // to an RSVP record — that is a staff screen which would bounce them
    // straight back here.
    await expect(page.getByRole('navigation', { name: 'Event sections' })).toHaveCount(0)
    await expect(page.locator('a[href*="/rsvp/"]')).toHaveCount(0)

    await context.close()
  })

  test('C4 search narrows the list', async ({ browser }) => {
    const { context, page } = await loggedInContext(browser, clientState)

    await page.goto('/')
    await page.waitForURL(/\/guests$/, { timeout: 30_000 })
    await expect(page.getByRole('article').first()).toBeVisible({ timeout: 20_000 })

    const firstName = (await page.getByRole('article').first().getByRole('heading').first().textContent())?.trim()
    expect(firstName, 'the first card should carry a name to search for').toBeTruthy()

    await page.getByLabel('Search guests').fill(firstName!.slice(0, 4))
    await expect(page.getByText(/famil(y|ies) match/)).toBeVisible()
    await expect(page.getByRole('article').first()).toBeVisible()

    await context.close()
  })
})
