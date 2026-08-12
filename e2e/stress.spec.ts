import { test, expect } from '@playwright/test'

import { login, loggedInContext, USERS } from './helpers/auth'
import { db, EVENT_ID, resetTestData, createPendingDeliverable } from './helpers/db'

/**
 * STRESS — not scored; predicts venue behaviour. The full guest list import,
 * slow-3G browsing, and a timed end-to-end loop.
 *
 * S3 is scoped to the flows that actually exist (import → room suggest →
 * photo proof). The RSVP and check-in legs reference UI that is NOT BUILT;
 * they are excluded from the timed loop and reported as such.
 */

test.describe.configure({ mode: 'serial' })

let stateA: string

test.beforeAll(async ({ browser }) => {
  await resetTestData()
  stateA = await login(browser, USERS.a)
})

async function eventCode(): Promise<string> {
  const { data } = await db.from('events').select('code').eq('id', EVENT_ID).maybeSingle()
  if (!data) throw new Error(`E2E_EVENT_ID ${EVENT_ID} does not resolve to an event.`)
  return data.code
}

test('S1 full load — guest list interactive time', async ({ browser }) => {
  const code = await eventCode()
  const { context, page } = await loggedInContext(browser, stateA)

  // The guest list is now windowed: the DB returns all rows (fast, indexed),
  // and the browser mounts only the visible window. S1 measures the whole
  // navigate + data-fetch + first-window paint at the seeded 543+ scale.
  const { count: dbCount } = await db.from('guest_groups').select('*', { count: 'exact', head: true }).eq('event_id', EVENT_ID)

  const started = Date.now()
  await page.goto(`/${code}/guests`)
  // The count line is the REAL "data loaded" signal (the heading renders
  // before the fetch completes). Wait for it, then measure.
  await expect(page.getByRole('heading', { name: 'Guest list' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(new RegExp(`${dbCount} guest`))).toBeVisible({ timeout: 20_000 })
  const elapsed = Date.now() - started

  console.log(`S1: guest list interactive (${dbCount} guests) in ${elapsed}ms`)
  // Budget at scale: 3s is the venue target; allow 5s here for the dev
  // machine's network RTT to the cloud DB.
  expect(elapsed).toBeLessThan(5000)

  await context.close()
})

test('S2 slow connection — walk the core loop', async () => {
  test.skip(true, 'CDP network throttling needs a persistent CDP session; the headless runner does not expose one portably. Reported MANUAL (run in Chrome DevTools Slow 3G).')
})

test('S3 timed loop — import → room suggest → photo proof', async ({ browser }) => {
  const code = await eventCode()
  const { context, page } = await loggedInContext(browser, stateA)

  const started = Date.now()

  // 1. Import (idempotent — data already present from Tier 0, so this is a
  //    re-import no-op, which is the honest venue path for double-clicks).
  await page.goto(`/${code}/import`)
  await expect(page.getByRole('button', { name: 'Choose file', exact: true })).toBeVisible({ timeout: 20_000 })
  await page.locator('input[type="file"]').setInputFiles('e2e/fixtures/guests-test.xlsx')
  await expect(page.getByRole('button', { name: 'Confirm import' })).toBeVisible({ timeout: 30_000 })

  // 2. Room suggest screen loads with real data — the allocator only lists
  //    CONFIRMED families, so create one (fresh, unique) plus a room for it.
  const stamp = Date.now().toString(36)
  const { data: hotel, error: hErr } = await db
    .from('hotels')
    .insert({ event_id: EVENT_ID, name: `S3 Hotel ${stamp}` })
    .select('id')
    .single()
  expect(hErr).toBeNull()
  const { data: room, error: rErr } = await db
    .from('rooms')
    .insert({ event_id: EVENT_ID, hotel_id: hotel!.id, room_number: `S3-${stamp}`, capacity: 4, max_capacity: 4 })
    .select('id')
    .single()
  expect(rErr).toBeNull()
  const { data: group, error: gErr } = await db
    .from('guest_groups')
    .insert({ event_id: EVENT_ID, head_name: `S3 Family ${stamp}`, expected_pax: 2, rsvp_status: 'confirmed', confirmed_pax: 2 })
    .select('id')
    .single()
  expect(gErr).toBeNull()
  const { error: guestErr } = await db
    .from('guests')
    .insert({ event_id: EVENT_ID, group_id: group!.id, full_name: `S3 Family ${stamp}`, is_head: true })
  expect(guestErr).toBeNull()

  await page.goto(`/${code}/rooms/allocate`)
  await expect(page.locator('body')).toContainText(/Room allocation|Suggest|assign/i, { timeout: 15_000 })

  // Clean up the throwaway hotel/room (the reset does not touch rooms/hotels,
  // and `hotels` is unique on (event_id, name) — leaving it breaks run 2).
  await db.from('rooms').delete().eq('id', room!.id)
  await db.from('hotels').delete().eq('id', hotel!.id)

  // 3. Deliveries: create a fresh pending deliverable + photo proof.
  const { deliverableId } = await createPendingDeliverable()
  await page.goto(`/${code}/deliveries/${deliverableId}`)
  await expect(page.getByText(/Confirm you are at the right door/i)).toBeVisible({ timeout: 15_000 })
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles('e2e/fixtures/proof-test.jpg')
  await expect(page.getByRole('button', { name: /Confirm delivery/i })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: /Confirm delivery/i }).click()
  // The sealed state — "Already delivered" must not count as a fresh proof.
  await expect(page.getByText(/SEALED|PROOF RECORDED/i).first()).toBeVisible({ timeout: 20_000 })

  const seconds = (Date.now() - started) / 1000
  console.log(`S3: loop took ${seconds.toFixed(1)}s`)
  console.log(`S3: at 238 families that is ${((seconds * 238) / 3600).toFixed(1)} hours of staff work`)

  await context.close()
})
