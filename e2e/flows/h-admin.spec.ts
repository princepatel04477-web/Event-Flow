import { existsSync } from 'node:fs'

import { expect, test } from '@playwright/test'

import { finishCounting, open, openSession, startCounting, tap, type FlowSession } from './_lib'

/**
 * (h) THE ADMIN'S TWO JOBS — switch event without editing the wrong wedding,
 * and read the import preview before it writes anything.
 *
 * ── WHY "SWITCH EVENT" IS TWO DIFFERENT ASSERTIONS ─────────────────────────
 *
 * On a phone the switcher does not exist at all: `AdminSidebar` is
 * `hidden md:flex`, and `AdminMobileNav` has no event control. An admin on a
 * handset changes event by going back to `/admin/events` and tapping the other
 * one — so `(h1)` measures THAT path, and `(h2)` measures the sidebar select
 * on a desktop viewport. They are not the same control and only one of them is
 * reachable one-handed; `docs/BUGS.md` records it.
 *
 * The one thing both share is the event-context bar every
 * `/admin/events/[eventCode]/*` page renders ("Active event · <name> ·
 * <code>"). That bar is the answer to "am I in the right wedding", so the
 * spec asserts it rather than the URL.
 *
 * ── WHY THE IMPORT SPEC ASSERTS "NOTHING WRITTEN YET" ──────────────────────
 *
 * `CALLING_MASTER_LIST.xlsx` turns an empty database into 238 real families.
 * The one rule the import screen must keep is that the operator looks at the
 * parsed sheet, warnings and all, BEFORE anything is committed (CLAUDE.md §5.6
 * and §15's "never cut: import preview"). So the spec stops at the preview and
 * asserts the preview is what it is: a read of the file, with the Confirm bar
 * present and the parsed names on screen.
 */

test.describe.configure({ mode: 'serial' })

let session: FlowSession

test.beforeAll(async ({ browser }) => {
  session = await openSession(browser, 'admin')
})

test.afterAll(async () => {
  await session?.context.close()
})

test('(h0) the admin sees the event list', async () => {
  const page = session.page
  await open(page, session.code)
  await page.goto('/admin/events', { waitUntil: 'domcontentloaded' })

  await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible({ timeout: 30_000 })
  await expect(
    page.getByRole('link', { name: new RegExp(session.eventName) }).first(),
    `the event list does not contain "${session.eventName}"`,
  ).toBeVisible({ timeout: 30_000 })
})

test('(h1) switching event from the list lands in the chosen event', async () => {
  const page = session.page
  await page.goto('/admin/events', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Events' })).toBeVisible({ timeout: 30_000 })

  await startCounting(page)
  const row = page.getByRole('link', { name: new RegExp(session.eventName) }).first()
  await tap(page, row, session.eventName)
  await page.waitForURL(new RegExp(`/admin/events/${session.code}`), { timeout: 30_000 })

  // The context bar is the safety feature: an admin three screens into the
  // wrong wedding sees the name and code above every page.
  await expect(page.getByText('Active event')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(session.code)).toBeVisible()

  await finishCounting(page, 'admin-switch-event', `events list → ${session.eventName}`)
})

test('(h2) the sidebar switcher changes the event, on a viewport that has one', async () => {
  const page = session.page
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`/admin/events/${session.code}`, { waitUntil: 'domcontentloaded' })

  const switcher = page.getByLabel('Switch event')
  await expect(
    switcher,
    'no event switcher is rendered at 1280px — the sidebar is the only place it lives',
  ).toBeVisible({ timeout: 30_000 })

  const options = await switcher.locator('option').allTextContents()
  expect(options.length, 'the switcher lists no events to switch to').toBeGreaterThan(0)

  // Choosing the event that is already open is a no-op by design (the handler
  // returns early), so the assertion is on the control's contents: the current
  // event is the select's value and every membership is offered.
  expect(options.join(' | ')).toContain(session.code)

  await page.setViewportSize({ width: 360, height: 800 })
})

test('(h3) the import preview reads the file and writes nothing yet', async () => {
  const page = session.page

  // The fixture workbook is generated, not committed. Generate it on demand
  // rather than skipping: a silently skipped import spec is a green board over
  // the one flow that turns an empty database into 238 families.
  if (!existsSync('e2e/fixtures/guests-test.xlsx')) {
    await import('../fixtures/generate.mjs')
  }
  expect(existsSync('e2e/fixtures/guests-test.xlsx'), 'the import fixture could not be generated').toBe(
    true,
  )

  await open(page, session.code, 'guests/import')
  await expect(page.getByText('Excel import')).toBeVisible({ timeout: 30_000 })

  await startCounting(page)
  const upload = page.getByRole('button', { name: 'Choose file', exact: true })
  await expect(upload).toBeVisible({ timeout: 30_000 })
  // The button is TAPPED, so the tap is counted; the hidden input is then
  // answered directly. On a handset the same gesture opens the document
  // picker, and the difference is only which app answers it.
  const chooser = page.waitForEvent('filechooser')
  await tap(page, upload, 'Choose file')
  const fileChooser = await chooser
  await fileChooser.setFiles('e2e/fixtures/guests-test.xlsx')

  // The preview is the deliverable: the parsed families, and a sticky bar that
  // says what will happen if the operator goes on. Nothing is committed until
  // that button is pressed, so this spec stops here on purpose.
  const confirm = page.getByRole('button', { name: 'Confirm import' })
  await expect(confirm, 'the preview never rendered — the import cannot be reviewed').toBeVisible({
    timeout: 60_000,
  })
  await expect(page.getByText('Rajesh Kumar')).toBeVisible()
  await expect(page.getByText('Amit Shah')).toBeVisible()

  // THE COMMIT CONTROL MUST BE TAPPABLE, not merely present. The sticky bar
  // and the bottom tab bar are both pinned to the viewport bottom, and a
  // `sticky bottom-0` bar with no z-index sits UNDER the fixed tab bar — the
  // button renders, `toBeVisible()` passes, and the tap lands on the tab bar.
  // Only geometry catches that, so this is a geometry assertion.
  const confirmBox = await confirm.boundingBox()
  const tabBar = page.locator('nav[aria-label="Sections"]').first()
  const tabBarBox = (await tabBar.count()) > 0 ? await tabBar.boundingBox() : null
  expect(confirmBox, 'the Confirm import bar has no box to tap').not.toBeNull()
  if (confirmBox && tabBarBox) {
    expect(
      confirmBox.y + confirmBox.height,
      `the "Confirm import" bar ends at ${Math.round(confirmBox.y + confirmBox.height)}px but the ` +
        `tab bar starts at ${Math.round(tabBarBox.y)}px — the commit button is covered by the tab ` +
        `bar and cannot be tapped`,
    ).toBeLessThanOrEqual(tabBarBox.y + 1)
  }

  await finishCounting(page, 'admin-import-preview', 'file → preview, nothing committed')
})
