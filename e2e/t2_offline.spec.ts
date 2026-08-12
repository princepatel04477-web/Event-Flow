import { expect, test, type Page } from '@playwright/test'

import { loggedInContext, loginTeam } from './helpers/auth'
import { db, EVENT_ID } from './helpers/db'

/**
 * T2 items 3, 4, 5 and 8 — the browser-shaped half of venue reality.
 *
 * `tests/t2_reality.test.ts` covers everything the DATABASE or a pure parser
 * decides. These four need a real page, a real IndexedDB and a real network
 * toggle, so they live here — as that file's header says they should.
 *
 * SERVICE ROLE NOTE. `helpers/db` is service role, and that is correct here:
 * it is the ORACLE, not the subject. The rule in T1 — and the finding in
 * `T1-AUDIT.md` — is about ISOLATION tests, where service role bypasses the
 * very policy under test. Counting rows that the APP wrote through a real
 * session proves something service role cannot fake.
 *
 * WHAT THESE LOOK FOR. Not "does the function return the right value". The
 * failure that costs data on the day is a write that silently happens twice,
 * or silently not at all, when the venue Wi-Fi drops mid-tap.
 */

// Read from src/lib/call/outbox.ts. If either changes, `queueOffline` throws
// rather than quietly queueing nothing and reporting a green pass.
const OUTBOX_DB = 'eventflow-call-outbox'
const OUTBOX_STORE = 'pending-completions'

const TAG = `T2OFF-${Date.now().toString(36)}`

/** Resolve the event's URL code from E2E_EVENT_ID, the way tier1.spec.ts does. */
async function eventCode(): Promise<string> {
  const { data } = await db.from('events').select('code').eq('id', EVENT_ID).maybeSingle()
  if (!data) throw new Error(`E2E_EVENT_ID ${EVENT_ID} does not resolve to an event.`)
  return data.code
}

interface SeededAttempt {
  attemptId: string
  groupId: string
}

/**
 * Seed N call_attempts with NO outcome — the state a phone is in once it has
 * dialled and not yet logged a result. The outbox replays the COMPLETION, so
 * the rows have to exist first.
 */
async function seedOpenAttempts(count: number): Promise<SeededAttempt[]> {
  const { data: group, error: gErr } = await db
    .from('guest_groups')
    .insert({
      event_id: EVENT_ID,
      head_name: `${TAG}-family`,
      primary_mobile: '9800000009',
      expected_pax: 2,
      rsvp_status: 'not_started',
    })
    .select('id')
    .single()
  if (gErr) throw new Error(`seed group: ${gErr.message}`)

  const { data, error } = await db
    .from('call_attempts')
    .insert(
      Array.from({ length: count }, () => ({
        event_id: EVENT_ID,
        group_id: group.id,
        dialed_number: '9800000009',
      })),
    )
    .select('id')
  if (error) throw new Error(`seed attempts: ${error.message}`)

  return (data ?? []).map((r) => ({ attemptId: r.id, groupId: group.id }))
}

/** How many of these attempts the server considers finalized. */
async function finalizedCount(attemptIds: string[]): Promise<number> {
  const { data, error } = await db
    .from('call_attempts')
    .select('id, outcome, finalized_at')
    .in('id', attemptIds)
  if (error) throw new Error(`read attempts: ${error.message}`)
  return (data ?? []).filter((r) => r.outcome !== null && r.finalized_at !== null).length
}

/** Every attempt row for the group — catches a replay that INSERTs instead of updating. */
async function attemptRowCount(groupId: string): Promise<number> {
  const { count, error } = await db
    .from('call_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('group_id', groupId)
  if (error) throw new Error(`count attempts: ${error.message}`)
  return count ?? 0
}

/**
 * Write queued completions straight into the app's IndexedDB.
 *
 * Raw IDB rather than driving five calls through the dialer, deliberately:
 * the subject here is the REPLAY, and five UI journeys would make the
 * interesting assertion depend on twenty incidental ones. `keyPath` is
 * `payload.attemptId`, so the shape below has to match what the app stores.
 */
async function queueOffline(
  page: Page,
  attempts: SeededAttempt[],
  eventCode: string,
): Promise<number> {
  return page.evaluate(
    async ({ dbName, storeName, items }) => {
      const idb: IDBDatabase = await new Promise((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })

      if (!idb.objectStoreNames.contains(storeName)) {
        throw new Error(
          `outbox store "${storeName}" is missing — the app never opened it, or it was renamed`,
        )
      }

      await new Promise<void>((resolve, reject) => {
        const tx = idb.transaction(storeName, 'readwrite')
        const store = tx.objectStore(storeName)
        for (const item of items) store.put(item)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })

      return new Promise<number>((resolve, reject) => {
        const tx = idb.transaction(storeName, 'readonly')
        const req = tx.objectStore(storeName).count()
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
    },
    {
      dbName: OUTBOX_DB,
      storeName: OUTBOX_STORE,
      items: attempts.map((a, i) => ({
        payload: {
          attemptId: a.attemptId,
          eventId: EVENT_ID,
          eventCode,
          groupId: a.groupId,
          outcome: 'no_answer',
          notes: `${TAG} queued offline #${i + 1}`,
          callbackAt: null,
          endedAt: new Date().toISOString(),
          durationSec: null,
        },
        queuedAt: new Date().toISOString(),
        attempts: 0,
      })),
    },
  )
}

/** How many items are still sitting in the outbox. -1 when the store is absent. */
async function outboxDepth(page: Page): Promise<number> {
  return page.evaluate(
    async ({ dbName, storeName }) => {
      const idb: IDBDatabase = await new Promise((resolve, reject) => {
        const req = indexedDB.open(dbName)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
      if (!idb.objectStoreNames.contains(storeName)) return -1
      return new Promise<number>((resolve, reject) => {
        const tx = idb.transaction(storeName, 'readonly')
        const req = tx.objectStore(storeName).count()
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
    },
    { dbName: OUTBOX_DB, storeName: OUTBOX_STORE },
  )
}

/** Wait for the outbox to empty, then let the assertions report the truth. */
async function waitForDrain(page: Page, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await outboxDepth(page)) === 0) return
    await page.waitForTimeout(500)
  }
}

test.describe('T2 — offline, session and scale', () => {
  test.describe.configure({ mode: 'serial' })

  // ------------------------------------------------------------------
  // T2.4 — the priority. Five queued writes land exactly five times, and
  // are STILL five after a double reconnect.
  // ------------------------------------------------------------------
  test('T2.4 five offline writes land exactly once each, even on a double reconnect', async ({
    browser,
  }) => {
    const { context, page } = await loggedInContext(browser, await loginTeam(browser))
    const code = await eventCode()

    const attempts = await seedOpenAttempts(5)
    const ids = attempts.map((a) => a.attemptId)
    const groupId = attempts[0].groupId
    const rowsBefore = await attemptRowCount(groupId)

    // Mounting the call screen registers the drain listener.
    await page.goto(`/${code}/rsvp/call/${groupId}`)
    await page.waitForLoadState('networkidle')

    await context.setOffline(true)

    expect(await queueOffline(page, attempts, code), 'five queued while offline').toBe(5)
    expect(await finalizedCount(ids), 'nothing reached the server while offline').toBe(0)

    // --- first reconnect ---
    await context.setOffline(false)
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await waitForDrain(page)

    expect(await finalizedCount(ids), 'all five landed after reconnecting').toBe(5)
    expect(
      await attemptRowCount(groupId),
      'the replay UPDATED the five attempts rather than inserting new ones',
    ).toBe(rowsBefore)

    // --- double reconnect, back to back ---
    //
    // This is the failure that costs data on the day. `drainOutbox` has NO
    // concurrency guard: two 'online' events both call
    // listQueuedCompletions() before either removes anything, so both submit
    // the same payloads. What must hold is that the SERVER still shows five —
    // `app.guard_call_attempt()` freezes a row the instant `outcome` goes
    // non-null, so the second submission is refused rather than applied twice.
    //
    // If this assertion ever fails, the freeze is what broke, and the outbox
    // needs a real in-flight lock rather than relying on the database.
    await page.evaluate(() => {
      window.dispatchEvent(new Event('online'))
      window.dispatchEvent(new Event('online'))
    })
    await page.waitForTimeout(3_000)
    await waitForDrain(page)

    expect(
      await finalizedCount(ids),
      'STILL exactly five after a double reconnect — nothing applied twice',
    ).toBe(5)
    expect(
      await attemptRowCount(groupId),
      'STILL no extra attempt rows after a double reconnect',
    ).toBe(rowsBefore)
    expect(await outboxDepth(page), 'outbox empty — nothing stranded on the phone').toBe(0)

    await context.close()
  })

  // ------------------------------------------------------------------
  // T2.3 — dropping offline mid-log loses nothing and duplicates nothing.
  // ------------------------------------------------------------------
  test('T2.3 going offline mid-call-log loses nothing and duplicates nothing', async ({
    browser,
  }) => {
    const { context, page } = await loggedInContext(browser, await loginTeam(browser))
    const code = await eventCode()

    const [attempt] = await seedOpenAttempts(1)
    const rowsBefore = await attemptRowCount(attempt.groupId)

    await page.goto(`/${code}/rsvp/call/${attempt.groupId}`)
    await page.waitForLoadState('networkidle')

    // The drop happens BEFORE the outcome is submitted — a caller tapping in
    // a corridor as the Wi-Fi hands over.
    await context.setOffline(true)
    await queueOffline(page, [attempt], code)

    expect(await finalizedCount([attempt.attemptId]), 'not applied while offline').toBe(0)
    expect(await outboxDepth(page), 'held on the phone, not lost').toBe(1)

    await context.setOffline(false)
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await waitForDrain(page)

    expect(await finalizedCount([attempt.attemptId]), 'applied exactly once on reconnect').toBe(1)
    expect(await attemptRowCount(attempt.groupId), 'no duplicate row').toBe(rowsBefore)

    await context.close()
  })

  // ------------------------------------------------------------------
  // T2.5 — kill the app mid-flow. Session survives, no partial row.
  // ------------------------------------------------------------------
  test('T2.5 killing and relaunching mid-flow keeps the session and writes no partial row', async ({
    browser,
  }) => {
    const { context, page } = await loggedInContext(browser, await loginTeam(browser))
    const code = await eventCode()

    const [attempt] = await seedOpenAttempts(1)
    const rowsBefore = await attemptRowCount(attempt.groupId)

    await page.goto(`/${code}/rsvp/call/${attempt.groupId}`)
    await page.waitForLoadState('networkidle')

    // Queue, then close the page before it can drain — the app being swiped
    // away mid-flow.
    await context.setOffline(true)
    await queueOffline(page, [attempt], code)
    await page.close()

    // Relaunch in the SAME context: cookies persist, which is what "the
    // session survives" means for a cookie-based Supabase session.
    await context.setOffline(false)
    const relaunched = await context.newPage()
    await relaunched.goto(`/${code}/rsvp/call/${attempt.groupId}`)
    await relaunched.waitForLoadState('networkidle')

    expect(relaunched.url(), 'still signed in after relaunch, not bounced to /login').not.toContain(
      '/login',
    )

    // The call screen drains on mount, so the queued outcome lands with no tap.
    await waitForDrain(relaunched)

    expect(
      await finalizedCount([attempt.attemptId]),
      'the queued outcome survived the kill and applied once',
    ).toBe(1)
    expect(
      await attemptRowCount(attempt.groupId),
      'no partial or duplicate row from the interrupted flow',
    ).toBe(rowsBefore)

    await context.close()
  })

  // ------------------------------------------------------------------
  // T2.8 — scale. Measured numbers, and honest about what they measured.
  // ------------------------------------------------------------------
  test('T2.8 guest list and calling queue render at full size', async ({ browser }) => {
    const { context, page } = await loggedInContext(browser, await loginTeam(browser))
    const code = await eventCode()

    // Report what the numbers were measured AGAINST. A fast render over 12
    // families says nothing at all about 238.
    const [{ count: guests }, { count: families }, { count: rooms }] = await Promise.all([
      db.from('guests').select('id', { count: 'exact', head: true }).eq('event_id', EVENT_ID),
      db.from('guest_groups').select('id', { count: 'exact', head: true }).eq('event_id', EVENT_ID),
      db.from('rooms').select('id', { count: 'exact', head: true }).eq('event_id', EVENT_ID),
    ])

    // A 4x CPU throttle is the closest a desktop Chromium gets to the cheap
    // Android handsets this team actually carries.
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })

    const timings: Record<string, number> = {}
    for (const [label, path] of [
      ['guest list', `/${code}/guests`],
      ['calling queue', `/${code}/rsvp/queue`],
    ] as const) {
      const started = Date.now()
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      timings[label] = Date.now() - started
    }

    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })

    console.log(
      `\nT2.8 scale — ${families ?? 0} families / ${guests ?? 0} guests / ${rooms ?? 0} rooms, ` +
        `4x CPU throttle\n` +
        `  guest list     ${timings['guest list']} ms\n` +
        `  calling queue  ${timings['calling queue']} ms\n`,
    )

    // A soft ceiling. Ten seconds on a throttled CPU already changes how the
    // team works, so failing above it makes the number impossible to ignore.
    expect(timings['guest list'], 'guest list render').toBeLessThan(10_000)
    expect(timings['calling queue'], 'calling queue render').toBeLessThan(10_000)

    if ((families ?? 0) < 200) {
      console.warn(
        `T2.8 WARNING: measured against ${families ?? 0} families, not the ~238 of the real ` +
          `event. These timings are OPTIMISTIC — load the full sheet before trusting them.`,
      )
    }

    await context.close()
  })
})
