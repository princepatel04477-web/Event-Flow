import { expect, test } from '@playwright/test'

import { FAMILIES, seed, unseed } from '../v12-seed.mjs'
import { openSession, notFoundNote, tap, type FlowSession } from './_lib'

/**
 * (g) THE CLIENT'S LOGIN IS READ-ONLY.
 *
 * A client is one role with one screen: `client_guest_profiles`, read-only,
 * and zero rows from every base table. That is enforced in the database — this
 * spec is about the SCREEN, and the two are different claims:
 *
 *   - the screen must not OFFER a write it cannot perform (a Save button that
 *     RLS refuses is a lie the runner-in-reverse sees);
 *   - the screen must not LINK anywhere a client is not allowed to go, because
 *     every staff destination bounces them off the screen they just found
 *     (UX-RULES R3, and the reason `GuestSheet` takes `familyHref={null}`).
 *
 * And the control: a client asking for a staff URL must not get the staff
 * screen. RLS is the fence; the screen must not pretend otherwise in the other
 * direction either, by rendering a usable rooms board for a client.
 */

test.describe.configure({ mode: 'serial' })

let session: FlowSession

test.beforeAll(async ({ browser }) => {
  session = await openSession(browser, 'client')
  await seed()
})

test.afterAll(async () => {
  await unseed().catch(() => {})
  await session?.context.close()
})

/** Every control whose presence would be a write on a client's screen. */
const WRITE_CONTROLS =
  /\b(save|confirm|delete|remove|move|assign|add a guest|check in|checked in|delivered|take photo|auto-fill|import|send)\b/i

test('(g1) a client lands on their guest list, not the error boundary', async () => {
  const page = session.page
  await page.goto('/')
  await page.waitForURL(/\/guests$/, { timeout: 30_000 })

  await expect(page.getByText('This screen did not load')).toHaveCount(0)
  await expect(notFoundNote(page)).toHaveCount(0)
  // The count line is the screen's own claim about what it read: a client
  // pointed at a staff source reaches this line saying nothing.
  await expect(page.getByText(/guests · read-only/)).toBeVisible({ timeout: 30_000 })
})

test('(g2) the client screen offers no write and no way onto a staff screen', async () => {
  const page = session.page
  await page.goto(`/${session.code}/guests`)
  await expect(page.getByText(/guests · read-only/)).toBeVisible({ timeout: 30_000 })

  const offenders = await page.locator('main button, main a[href]').evaluateAll(
    (nodes, pattern) =>
      nodes
        .map((n) => ({
          text: (n.textContent ?? '').replace(/\s+/g, ' ').trim(),
          href: n.getAttribute('href') ?? '',
        }))
        .filter(({ text, href }) => {
          if (/^Clear search$/i.test(text)) return false
          if (/^Show \d+ more/.test(text)) return false
          if (/^Close$/i.test(text)) return false
          return new RegExp(pattern, 'i').test(`${text} ${href}`)
        }),
    WRITE_CONTROLS.source,
  )

  expect(
    offenders,
    `a client's only screen offers something it cannot do, or links into a staff screen: ` +
      JSON.stringify(offenders),
  ).toEqual([])
})

test('(g3) a client can search their own list and read a profile', async () => {
  const page = session.page
  await page.goto(`/${session.code}/guests`)
  await expect(page.getByText(/guests · read-only/)).toBeVisible({ timeout: 30_000 })

  const field = page.getByPlaceholder('Name or room number')
  await field.waitFor({ state: 'visible', timeout: 30_000 })
  await tap(page, field, 'client search field')
  await field.fill('Sharma')

  const row = page
    .getByRole('list', { name: 'Guests' })
    .getByRole('button', { name: new RegExp(FAMILIES.search) })
    .first()
  await expect(row, 'a client cannot find a guest on their own list').toBeVisible({
    timeout: 30_000,
  })
  await tap(page, row, FAMILIES.search)

  const sheet = page.getByRole('dialog', { name: /guest details$/ })
  await expect(sheet).toBeVisible({ timeout: 20_000 })
  // The profile card answers the client's own question — who came, and what
  // they are getting — and every way off it stays on this screen.
  await expect(sheet.getByText('Arrival')).toBeVisible()
  await expect(sheet.getByText('Hamper')).toBeVisible()
  await expect(
    sheet.getByRole('link', { name: /Open the family record/ }),
    'the client profile links to a staff screen, which would bounce them off it',
  ).toHaveCount(0)
  await expect(sheet.getByRole('button', { name: 'Close' })).toBeVisible()
})

test('(g4) a client asking for a staff URL does not get the staff screen', async () => {
  const page = session.page
  await page.goto(`/${session.code}/hospitality/rooms`, { waitUntil: 'domcontentloaded' })

  // Whatever they are shown, it must not be the rooms board: no auto-fill, no
  // room cards, no placement controls.
  await expect(page.getByRole('button', { name: /^Auto-fill/ })).toHaveCount(0)
  await expect(page.getByRole('tablist', { name: 'Which list' })).toHaveCount(0)
})
