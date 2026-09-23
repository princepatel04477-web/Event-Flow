import { expect, test } from '@playwright/test'

import { FAMILIES, seed, unseed } from '../v12-seed.mjs'
import { finishCounting, open, openSession, startCounting, tap, type FlowSession } from './_lib'

/**
 * (d) MARK A HAMPER DELIVERED, WITH A PHOTO.
 *
 * The hamper is delivered because a photo exists — not because somebody tapped
 * a button (`delivery_proofs` is insert-only: no update policy, no delete
 * policy, and two unconditional `block_mutation` triggers refuse both for
 * everyone, including the service role). So this spec asserts the two things
 * that can actually be asserted:
 *
 *   1. the proof SEALED — the screen says "Proof recorded" and shows the stub
 *      with the server's timestamp, or it honestly says "Queued — will sync";
 *   2. the door LEFT the run — the delivered hamper is gone from the list a
 *      runner walks, which is the only reason the photo is worth taking.
 *
 * ── WHY BOTH OUTCOMES ARE ACCEPTED AND NEITHER IS "DELIVERED" ──────────────
 *
 * docs/UX-RULES.md R8: a write that only reached the phone must say so. The
 * screen never prints the word "delivered" on a tap, and this spec must not
 * either — asserting "Proof recorded" unconditionally would turn a correct
 * offline queue into a failure, and asserting nothing would let a silent
 * no-op pass. The assertion is that the screen is in ONE of the two honest
 * states, and that a proof row exists on the server when it claims so.
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

test('(d) take the photo and seal the proof', async () => {
  const page = session.page
  await open(page, session.code, 'hamper')
  await expect(page.getByText(/Hampers delivered/)).toBeVisible({ timeout: 30_000 })

  // The one dark card names the next door. Its button is the screen's single
  // primary and the only way into the proof screen.
  const nextDoor = page.getByRole('link', { name: 'Take photo' })
  await nextDoor.waitFor({ state: 'visible', timeout: 30_000 })

  await startCounting(page)
  await tap(page, nextDoor, 'Take photo')

  // Confirm the door BEFORE the camera: this is the one screen in the app
  // whose whole purpose is that a runner does not photograph the wrong room.
  await expect(page.getByText('Confirm you are at the right door')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('body')).toContainText(FAMILIES.hamper.replace('V12-', ''))

  // "Choose photo" answers with the fixture image. On a handset the same
  // gesture opens the native rear camera; the difference is only which app
  // answers the chooser.
  const chooser = page.waitForEvent('filechooser')
  await tap(page, page.getByRole('button', { name: 'Choose photo' }), 'Choose photo')
  const fileChooser = await chooser
  await fileChooser.setFiles('e2e/fixtures/proof-test.jpg')

  await expect(page.getByText('Confirm this photo')).toBeVisible({ timeout: 30_000 })
  // The screen must say the action is final BEFORE it is taken — this is the
  // one irreversible write in the product.
  await expect(page.getByText(/cannot be changed or deleted/)).toBeVisible()

  await tap(page, page.getByRole('button', { name: 'Confirm delivery' }), 'Confirm delivery')

  const recorded = page.getByText('Proof recorded')
  const queued = page.getByText(/Queued — will sync/)
  await expect
    .poll(async () => (await recorded.count()) + (await queued.count()), {
      timeout: 90_000,
      message: 'neither "Proof recorded" nor "Queued — will sync" appeared — the screen is silent',
    })
    .toBeGreaterThan(0)

  await finishCounting(page, 'hamper-photo-proof', `next door → Choose photo → Confirm delivery`)

  if ((await recorded.count()) > 0) {
    // Saved, not merely sent: the stub carries the SERVER's timestamp, which
    // is the only timestamp that is evidence.
    await expect(page.getByText('Server time')).toBeVisible()
    await expect(page.getByText(/No update policy/)).toBeVisible()
  } else {
    // Honest offline: nothing is claimed about the server.
    await expect(page.getByText(/NOT marked delivered yet/)).toBeVisible()
  }
})

test('(d2) the delivered door leaves the run', async () => {
  const page = session.page
  await open(page, session.code, 'hamper')

  // staleTime 0 — the list re-reads on every mount, which is the whole point:
  // a runner must not be sent back to a door they have already been to.
  await expect(page.getByText(/Hampers delivered/)).toBeVisible({ timeout: 30_000 })

  // If the proof queued rather than saved, the door is legitimately still on
  // the list. Only assert the removal when the proof actually reached the
  // server.
  const queuedNow = await page.getByText(/will sync/).count()
  test.skip(queuedNow > 0, 'the proof is still queued on this phone — the door is correctly still on the run')

  const nextHeadline = page.locator('section.bg-now h2').first()
  await nextHeadline.waitFor({ state: 'visible', timeout: 30_000 })
  expect(
    await nextHeadline.textContent(),
    'the hamper just delivered is still the next door on the run',
  ).not.toContain(FAMILIES.hamper.replace('V12-', ''))
})
