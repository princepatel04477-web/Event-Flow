import { readFileSync } from 'node:fs'

import { expect, test } from '@playwright/test'

import { loggedInContext, loginClient, loginTeam } from './helpers/auth'
import { db } from './helpers/db'
import { FAMILIES, seed, sessionEvent, unseed } from './v12-seed.mjs'
import {
  eventCodeFromUrl,
  installTapCounter,
  markOnboarded,
  readTaps,
  resetTaps,
} from './v12-taps.mjs'
import {
  probeStructure,
  task1CallNextFamily,
  task2LogOutcome,
  task2SheetOutcome,
  task3FindFamily,
  task4GiveRoom,
  task5HamperProof,
  task6UndoRoom,
  task7MarkArrived,
  task8ClientRoom,
  task9ClientArrivals,
} from './v12-tasks.mjs'

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * V12 — CAN A STRANGER DO THE JOB?
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * NINE TASKS, NINE TAP BUDGETS, AND ONE RULE: OVER BUDGET FAILS EVEN IF THE TASK
 * COMPLETES. That is the entire point of this file. A runner who gets there in
 * five taps has done the job and has also been slowed down by the screen, and a
 * suite that only asked "did it work" would report that as a pass.
 *
 * ── WHY THE ONBOARDING FLAG IS SET AND NOT CLICKED ────────────────────────
 *
 * Every test here starts from a fresh browser context, and a fresh context is a
 * fresh DEVICE. `_components/FirstRunCards.tsx` renders a full-screen
 * `fixed inset-0 z-50` overlay on a device that has not set
 * `nuvent.v2.onboarded`, so without `markOnboarded()` every task would measure
 * the three onboarding cards: the tap budgets would be counting taps on a
 * one-time tour, the controls underneath would be unclickable, and the numbers
 * would be wrong in the same direction for all nine tasks — which is the one
 * kind of wrong a budget cannot survive, because it would hide a real regression
 * behind a constant offset.
 *
 * `markOnboarded` writes the flag through `context.addInitScript`, BEFORE
 * `_components/device-flags.ts` runs its one-shot read at module import. Setting
 * it after a first navigation would let the cards render for a frame and then
 * vanish, which is exactly the flash that module's header says it exists to
 * prevent. The same script also sets the per-screen `AppHint` flags, for the
 * same reason: an unset hint mounts a capture-phase `pointerup` listener on the
 * document, so a runner's first tap after arriving would be spent clearing a
 * one-line hint instead of doing the job.
 *
 * Clicking through the cards was the other option and it is worse. It costs
 * three taps that belong to a one-time onboarding journey rather than to the
 * job, and a returning handset — the device a tap budget is a statement about —
 * never makes them.
 *
 * ── WHAT COUNTS AS A TAP ─────────────────────────────────────────────────
 *
 * A capture-phase listener in the browser counts `click`, `pointerup` and
 * `keydown`(Enter/Space), de-duplicated per gesture. Three event types because a
 * tap is not always a click: a touch handler that consumes the gesture never
 * produces one, and a screen-reader user's tap is a key press. Tapping a search
 * box counts; the characters typed afterwards do not, which is what makes
 * "find the family Sharma in three taps" a statement about the screen rather
 * than about the keyboard.
 *
 * ── WHICH EVENT THESE ARE MEASURED AGAINST ───────────────────────────────
 *
 * NOT `E2E_EVENT_ID`. That variable names `E12345` ("Nuvent Event"); `E2E_TEAM_CODE`
 * and `E2E_CLIENT_CODE` both resolve to `SAMPLE2026` in `event_access_codes`, and
 * a session holding the team code is quietly served the event home when it asks
 * for `E12345` — so nothing about the mistake is loud. `docs/FEEL-BASELINE.md`
 * records the same trap. `sessionEvent()` resolves the code from the access
 * code's own event row, and the first test asserts both codes agree.
 *
 * ── WHERE THE EXPECTED NUMBERS COME FROM ─────────────────────────────────
 *
 * `docs/INTERACTION-CONTRACT.md`'s Budgets table is about TIME. The tap budgets
 * are the brief's, and they are not soft: each is the number of taps the job
 * needs with no screen in the way. The budgets are asserted here, and the same
 * task definitions are driven by `scripts/tap-budget.mjs` for a runner-free
 * measurement — one definition, two consumers, so the printed number and the
 * asserted number cannot drift apart.
 */

// Serial, like the rest of this suite: every test signs in for real and the
// tasks write rows (`call_attempts` freezes on first write, `delivery_proofs`
// are insert-only), so a parallel run would have two tests mutating the same
// family's state and the budgets would measure each other's writes.
test.describe.configure({ mode: 'serial' })

let code = ''
let clientCodeOk = false
/** The event's id, resolved from the ACCESS CODES rather than from E2E_EVENT_ID. */
let eventId = ''

test.beforeAll(async () => {
  const event = await sessionEvent()
  code = event.code
  eventId = event.id
  clientCodeOk = event.codesShareEvent
  expect(
    clientCodeOk,
    `E2E_TEAM_CODE and E2E_CLIENT_CODE must name the same event for the client tasks ` +
      `(team=${event.teamCodeEventId}, client=${event.clientCodeEventId})`,
  ).toBe(true)

  if (process.env.V12_SKIP_SEED !== '1') await seed()
})

test.afterAll(async () => {
  if (process.env.V12_SKIP_SEED !== '1') await unseed().catch(() => {})
})

/** A team context that is a RETURNING device: onboarded, hints dismissed, taps counted. */
async function teamContext(browser: Parameters<typeof loginTeam>[0]) {
  const state = await loginTeam(browser)
  const { context, page } = await loggedInContext(browser, state)
  await markOnboarded(context)
  await installTapCounter(context)
  return { context, page, state }
}

/** The same, for the client session. */
async function clientContext(browser: Parameters<typeof loginClient>[0]) {
  const state = await loginClient(browser)
  const { context, page } = await loggedInContext(browser, state)
  await markOnboarded(context)
  await installTapCounter(context)
  return { context, page }
}

/**
 * Every budget assertion goes through here, so a failure always names the task by
 * name and number.
 *
 * `null` IS NOT ZERO. A task measured `null` is one that cannot be done at all —
 * there is no control to tap — and reporting it as "0 taps, within budget" would
 * make the impossible task look like the cheapest one in the file. It fails
 * here, with the reason, and the message names the screen.
 */
function expectBudget(task: string, measured: number | null, budget: number, detail: string) {
  expect(
    measured,
    `${task} cannot be measured at all: ${detail}\n` +
      `      There is no control to tap within the budget of ${budget}, so this is not a tap-count ` +
      `failure — it is a missing screen or a screen that never renders. The screen to fix is named above.`,
  ).not.toBeNull()
  expect(measured, `${task}: the tap counter was not installed (measured ${measured})`).toBeGreaterThanOrEqual(0)
  expect(
    measured as number,
    `${task} took ${measured} taps against a budget of ${budget}. ${detail}\n` +
      `      A failing budget names the screen to fix next: reduce it or move this task off it.`,
  ).toBeLessThanOrEqual(budget)
}

// ═══════════════════════════════════════════════════════════════════════════
// WARM-UP: the routes are compiled and cached before the first budget is timed
// ═══════════════════════════════════════════════════════════════════════════

test('V12.0 every v2 route the budgets touch renders before timing starts', async ({ browser }) => {
  const { context, page } = await teamContext(browser)

  // A cold server render belongss to the deploy, not to the task. This test's
  // job is to make sure the OTHER tests are not the ones paying for it — and to
  // fail loudly here if a route is a 404, so a budget failure is never a
  // 404 in disguise.
  for (const path of [
    'rsvp/queue',
    'rsvp/campaigns',
    'guests/list',
    'hospitality/rooms',
    'hospitality/deliveries',
    'logistics/arrivals',
    'find',
  ]) {
    const resp = await page.goto(`/${code}/${path}`, { waitUntil: 'domcontentloaded' })
    expect(resp?.status(), `/${code}/${path} must answer 2xx`).toBeLessThan(400)
    await page.locator('main').waitFor({ state: 'visible', timeout: 30_000 })
    const body = (await page.locator('body').innerText()).toLowerCase()
    expect(
      body.includes('could not find that page') || body.includes('that page is not here'),
      `/${code}/${path} rendered the 404 screen`,
    ).toBe(false)
  }

  await context.close()
})

// ═══════════════════════════════════════════════════════════════════════════
// THE NINE TASKS
// ═══════════════════════════════════════════════════════════════════════════

test('V12.1 call the next family who needs calling, from a cold start — <= 2 taps', async ({
  browser,
}) => {
  const { context, page } = await teamContext(browser)
  const result = await task1CallNextFamily(page, code, FAMILIES.call)
  expectBudget('V12.1 call the next family', result.taps, 2, result.detail)
  await context.close()
})

test('V12.2 log that call\u2019s outcome — <= 2 taps', async ({ browser }) => {
  const { context, page } = await teamContext(browser)
  const result = await task2LogOutcome(page, code)
  expectBudget('V12.2 log the outcome', result.taps, 2, result.detail)
  await context.close()
})

test('V12.2b REPORT ONLY — the same outcome through the head-count sheet', async ({ browser }) => {
  // Not a budget. "Coming" and "Maybe" need a number the family actually said,
  // and `rsvpLogSchema` refuses a confirmed log without one, so the sheet is
  // correct rather than slow. It is measured anyway, because a screen that needs
  // three taps for the most common outcome on the calling list is a fact the
  // next session should have in front of it.
  const { context, page } = await teamContext(browser)
  const result = await task2SheetOutcome(page, code)
  console.log(`[obvious] V12.2b "Coming" via the head-count sheet: ${result.taps} taps (${result.detail})`)
  expect(result.taps, 'the sheet path must still be reachable').toBeGreaterThan(0)
  await context.close()
})

test('V12.3 find the family "Sharma" — <= 3 taps', async ({ browser }) => {
  const { context, page } = await teamContext(browser)
  const result = await task3FindFamily(page, code, FAMILIES.search)
  expectBudget('V12.3 find a family by name', result.taps, 3, result.detail)
  await context.close()
})

test('V12.4 give a family a room — <= 4 taps', async ({ browser }) => {
  const { context, page } = await teamContext(browser)
  const result = await task4GiveRoom(page, code, FAMILIES.room)
  expectBudget('V12.4 give a family a room', result.taps, 4, result.detail)
  await context.close()
})

test('V12.5 mark a hamper delivered, with a photo — <= 4 taps', async ({ browser }) => {
  const { context, page } = await teamContext(browser)
  const photo = readFileSync('e2e/fixtures/proof-test.jpg')
  const result = await task5HamperProof(page, code, photo)
  expectBudget('V12.5 hamper delivered with a photo', result.taps, 4, result.detail)
  await context.close()
})

test('V12.6 undo task 4 — <= 1 tap', async ({ browser }) => {
  const { context, page } = await teamContext(browser)

  // Done in ONE test rather than two, because the undo only exists inside the
  // seven-second window the room write opens (`src/lib/mutate/undo-store.ts`).
  // Two tests would mean two contexts, and by the second the offer has expired —
  // which would measure "no undo" and call it a budget failure.
  const placed = await task4GiveRoom(page, code, FAMILIES.room)
  expect(placed.taps, 'task 4 must complete before its undo can be measured').toBeGreaterThan(0)

  const result = await task6UndoRoom(page)
  expectBudget('V12.6 undo the room assignment', result.taps, 1, result.detail)

  // One tap must mean the write was actually reversed, not merely offered back.
  // Read through the service role (`e2e/helpers/db.ts` is the ORACLE, not the
  // subject): what the screen says and what the table holds are two different
  // claims, and a released assignment is the one that counts.
  const { data: group } = await db
    .from('guest_groups')
    .select('id')
    .eq('event_id', eventId)
    .ilike('head_name', FAMILIES.room)
    .maybeSingle()
  const { count } = await db
    .from('room_assignments')
    .select('id', { count: 'exact', head: true })
    .eq('group_id', group?.id ?? '00000000-0000-0000-0000-000000000000')
    .is('released_at', null)
  expect(count ?? 0, 'Undo must release the assignment, not leave it standing').toBe(0)

  await context.close()
})

test('V12.7 mark an arrival arrived — <= 3 taps', async ({ browser }) => {
  const { context, page } = await teamContext(browser)
  const result = await task7MarkArrived(page, code)
  expectBudget('V12.7 mark an arrival arrived', result.taps, 3, result.detail)
  await context.close()
})

test('V12.8 (client) find my own room number — <= 3 taps', async ({ browser }) => {
  const { context, page } = await clientContext(browser)
  const result = await task8ClientRoom(page, code, FAMILIES.clientRoom)

  // The number is printed as well as asserted. On this tree the client's guest
  // list never settles, so "did it pass" is a less useful fact than "how many
  // taps did it take, and did the lookup actually complete" — and a bare green
  // line would hide that the screen behind it is broken.
  console.log(
    `[obvious] V12.8 client room lookup: taps=${result.taps} completed=${result.completed} — ${result.detail}`,
  )

  expect(
    result.completed,
    `the client room lookup did not complete: ${result.detail}`,
  ).toBe(true)
  expectBudget('V12.8 find my own room number', result.taps, 3, result.detail)
  await context.close()
})

test('V12.9 (client) see who is arriving today — <= 2 taps', async ({ browser }) => {
  const { context, page } = await clientContext(browser)

  // This one is expected to FAIL on the current tree, and the failure is the
  // deliverable rather than a reason to loosen the budget: a client has no
  // bottom bar (`bottomTabsFor` returns none for them) and no arrivals screen,
  // so there is nothing to tap within any budget. `expectBudget` reports the
  // absence with the sentence the task returned, which names the screen.
  const result = await task9ClientArrivals(page, code, FAMILIES.clientArrival)
  expectBudget('V12.9 see who is arriving today', result.taps, 2, result.detail)
  expect(
    result.completed,
    `the client arrival lookup did not complete: ${result.detail}`,
  ).toBe(true)

  await context.close()
})

// ═══════════════════════════════════════════════════════════════════════════
// THE STRUCTURAL SWEEP — every route in the new group
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The routes the sweep covers, and whether each is a bottom-bar destination.
 *
 * "A visible back control, or it is a bottom-bar destination" is the brief's
 * rule, and it needs the second half: five of these screens ARE the bar's
 * destinations, and the bar's own tab is the way back. Demanding a back arrow on
 * them would fail a screen for being reachable, and the header deliberately
 * withholds one on the home (`AppHeader`: `backHref` is undefined when the path
 * is the home).
 */
const SWEEP = [
  { path: '', label: 'home', bar: true },
  { path: 'rsvp/queue', label: 'rsvp/queue (Calls tab)', bar: true },
  { path: 'rsvp/campaigns', label: 'rsvp/campaigns (the cold-start redirect target)', bar: false },
  { path: 'guests/list', label: 'guests/list (Guests tab)', bar: true },
  { path: 'hospitality/rooms', label: 'hospitality/rooms (Rooms tab)', bar: true },
  { path: 'hospitality/deliveries', label: 'hospitality/deliveries', bar: true },
  { path: 'logistics/arrivals', label: 'logistics/arrivals (Travel tab)', bar: true },
  { path: 'find', label: 'find (header search)', bar: false },
  { path: 'help', label: 'help (header ?)', bar: false },
]

test.describe('V12.10 structural sweep', () => {
  test.describe.configure({ mode: 'serial' })

  for (const route of SWEEP) {
    test(`${route.label} meets the structural rules`, async ({ browser }) => {
      const { context, page } = await teamContext(browser)
      await page.goto(`/${code}${route.path ? `/${route.path}` : ''}`, {
        waitUntil: 'domcontentloaded',
      })
      await page.locator('main').waitFor({ state: 'visible', timeout: 30_000 })
      await page.waitForTimeout(1_000)

      const probe = await probeStructure(page, { bottomBarDestination: route.bar })

      // One assertion, one message, every finding listed. A per-rule loop would
      // report the first failure and hide the rest, and the point of the sweep
      // is to hand the next session a worklist.
      expect(
        probe.results,
        `${route.label} (${probe.path}) breaks ${probe.results.length} structural rule(s):\n` +
          probe.results.map((r: { rule: string; detail: string }) => `        [${r.rule}] ${r.detail}`).join('\n'),
      ).toEqual([])

      expect(probe.bodyFontSize, `${route.label}: body font-size must be >= 16px`).toBeGreaterThanOrEqual(16)

      await context.close()
    })
  }
})

test('V12.11 the client screens meet the same structural rules', async ({ browser }) => {
  const { context, page } = await clientContext(browser)

  for (const path of ['guests', 'find']) {
    await page.goto(`/${code}/${path}`, { waitUntil: 'domcontentloaded' })
    await page.locator('main').waitFor({ state: 'visible', timeout: 30_000 })
    // The client's guest list is a legacy screen inside the new shell and
    // settles after it; a sweep run against the skeleton would measure nothing.
    await page.waitForTimeout(4_000)

    const probe = await probeStructure(page, { bottomBarDestination: false })
    expect(
      probe.results,
      `client /${path} (${probe.path}) breaks ${probe.results.length} structural rule(s):\n` +
        probe.results.map((r: { rule: string; detail: string }) => `        [${r.rule}] ${r.detail}`).join('\n'),
    ).toEqual([])
    expect(probe.bodyFontSize, `client /${path}: body font-size must be >= 16px`).toBeGreaterThanOrEqual(16)
  }

  await context.close()
})

// A last guard on the harness itself: if the counter is not installed, every
// budget above silently becomes "0 taps" and the whole file passes while
// measuring nothing. This asserts the instrument, not the app.
test('V12.12 the tap counter is installed and counts a real tap', async ({ browser }) => {
  const { context, page } = await teamContext(browser)
  await page.goto(`/${code}/rsvp/queue`, { waitUntil: 'domcontentloaded' })
  await page.locator('main').waitFor({ state: 'visible', timeout: 30_000 })
  await resetTaps(page)
  const before = await readTaps(page)
  expect(before, 'the counter starts at zero after a reset').toBe(0)

  // One real tap on a bar tab, delivered through the browser's input pipeline.
  const tab = page.locator('nav[aria-label="Sections"] a').first()
  const box = await tab.boundingBox()
  expect(box, 'the bar tab must have a box to tap').not.toBeNull()
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.waitForTimeout(500)

  const after = await readTaps(page)
  expect(
    after,
    `one tap on a bar tab must count as exactly one tap (counted ${after}) — a counter that ` +
      `does not move makes every budget in this file meaningless`,
  ).toBe(1)

  const path = new URL(page.url()).pathname
  expect(code, `the session's event code must appear in the URL (landed on ${path})`).toBe(
    eventCodeFromUrl(page.url()),
  )

  await context.close()
})
