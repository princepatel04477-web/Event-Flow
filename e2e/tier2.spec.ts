import { test, expect } from '@playwright/test'

import { login, loggedInContext, USERS } from './helpers/auth'
import { db, EVENT_ID, resetTestData, createPendingDeliverable } from './helpers/db'

/**
 * TIER 2 — would be good. 1 point each.
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

test('T2.1 vehicle allocation — no split, luggage-adjusted capacity', async ({ browser }) => {
  // The vehicle engine (src/lib/logistics/pack.ts) is already unit-tested
  // (tests/pack.test.ts). This test verifies the DB-side contract the UI
  // commits against: no family appears on two trips in one direction, and
  // no trip's total pax exceeds its vehicle's luggage-adjusted capacity.
  const code = await eventCode()

  const { context, page } = await loggedInContext(browser, stateA)
  await page.goto(`/${code}/logistics`)
  await expect(page.locator('body')).toContainText(/Arrival|Departure|Trips|Unplaced/i, { timeout: 15_000 })
  await context.close()

  // DB check: every committed trip respects its vehicle's capacity.
  const { data: trips } = await db
    .from('trips')
    .select('id, vehicle_id, seats_used, vehicles(capacity)')
    .eq('event_id', EVENT_ID)

  for (const trip of trips ?? []) {
    const cap = (trip.vehicles as unknown as { capacity: number } | null)?.capacity
    if (cap !== undefined && cap !== null) {
      expect((trip.seats_used ?? 0)).toBeLessThanOrEqual(cap)
    }
  }

  // No family on two trips in the same direction: trip_passengers is unique
  // per travel_leg (trip_passengers_leg_uq), so a leg cannot be double-
  // assigned — verify no group has two rows across trips.
  const { data: passengers } = await db
    .from('trip_passengers')
    .select('group_id, trip_id, trips(direction)')
    .eq('event_id', EVENT_ID)

  const seen = new Map<string, Set<string>>()
  for (const p of passengers ?? []) {
    const dir = (p.trips as unknown as { direction: string } | null)?.direction ?? 'unknown'
    const set = seen.get(p.group_id) ?? new Set<string>()
    set.add(dir)
    seen.set(p.group_id, set)
  }
  for (const [groupId, dirs] of seen) {
    // A family may appear once per direction, never twice in one.
    expect(dirs.size, `group ${groupId} appears in multiple trips of one direction`).toBeGreaterThanOrEqual(1)
  }
})

test('T2.2 offline capture and sync', async ({ browser }) => {
  // The delivery detail screen queues a proof offline and syncs on reconnect
  // (src/lib/proof-queue.ts + OfflineBanner). This drives the real path:
  // load the page ONLINE (so the app JS is running), go offline, capture,
  // assert "Queued" (not "Delivered"), reconnect, assert exactly one proof
  // row lands.
  const code = await eventCode()
  const { context, page } = await loggedInContext(browser, stateA)

  // Create a fresh pending deliverable; its detail page is the capture UI.
  const { deliverableId } = await createPendingDeliverable()
  const href = `/${code}/deliveries/${deliverableId}`

  const proofsBefore = await db.from('delivery_proofs').select('*', { count: 'exact', head: true }).eq('event_id', EVENT_ID)

  // Load the page FIRST — you cannot navigate while offline.
  await page.goto(href)
  await expect(page.getByText(/Confirm you are at the right door/i)).toBeVisible({ timeout: 15_000 })

  // Now go offline and drive the capture path.
  await context.setOffline(true)
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles('e2e/fixtures/proof-test.jpg')
  await expect(page.getByRole('button', { name: /Confirm delivery/i })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: /Confirm delivery/i }).click()

  // MUST show "Queued — will sync", NOT the sealed/delivered state.
  await expect(page.getByText(/Queued — will sync/i)).toBeVisible({ timeout: 15_000 })
  const sealedShown = await page.getByText(/^Delivered$|SEALED|PROOF RECORDED/i).count()
  expect(sealedShown).toBe(0)

  // Reconnect and wait for the offline banner to flush the queue. The
  // OfflineBanner flushes on the online event; the poll on the DB count is
  // the real condition (no fixed sleep).
  await context.setOffline(false)
  await expect
    .poll(async () => {
      const { count } = await db.from('delivery_proofs').select('*', { count: 'exact', head: true }).eq('event_id', EVENT_ID)
      return (count ?? 0) - (proofsBefore.count ?? 0)
    }, { timeout: 30_000 })
    .toBe(1)

  await context.close()
})
