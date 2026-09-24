/**
 * The shared harness for the end-to-end FLOW specs in `e2e/flows/`.
 *
 * ── WHAT THESE SPECS ARE FOR ────────────────────────────────────────────────
 *
 * `e2e/obvious.spec.ts` (V12) measures nine jobs against TAP BUDGETS. This
 * directory does something adjacent and not the same: it drives each real job
 * END TO END, through the UI, and asserts the job actually happened — the row
 * that changed, the proof that sealed, the text the screen now shows. A budget
 * measured on a screen that ignored the tap is not a budget, and a workflow
 * that renders perfectly while writing the wrong value is not a workflow.
 *
 * ── WHICH EVENT, AND WHY IT IS RESOLVED AND NOT READ FROM `.env.test` ───────
 *
 * `E2E_EVENT_ID` in `.env.test` names `E12345` ("Nuvent Event"). The team and
 * client access codes in the same file resolve to `SAMPLE2026`. Those are two
 * different events, and a session holding the team code that asks for
 * `E12345` is quietly served the event home instead of a 404 — so every spec
 * that trusted `E2E_EVENT_ID` navigated to a screen its own session could not
 * open and reported it as a missing element. `docs/FEEL-BASELINE.md` records
 * the trap and `e2e/obvious.spec.ts` already resolves the event from the
 * access code for exactly this reason. `testEvent()` below does the same, and
 * additionally REFUSES to run against the live/production event: several of
 * these flows write rows that can never be deleted (`call_attempts` freeze on
 * first write, `delivery_proofs` are insert-only), so pointing them at the
 * real wedding would be a permanent, unrecoverable mistake.
 *
 * ── HOW A TAP IS COUNTED ───────────────────────────────────────────────────
 *
 * The counter is the one in `e2e/v12-taps.mjs` — a capture-phase listener on
 * `click`, `pointerup` and Enter/Space, de-duplicated inside a 250ms window —
 * installed per CONTEXT so it survives client-side navigation. `tap()` paces
 * deliberate taps at least `TAP_PACING_MS` apart, because two taps 100ms apart
 * would otherwise be merged into one by that very de-duplication window and
 * the count would silently under-report. That is the counter's documented
 * trade (see its header), not a workaround: the fastest two deliberate taps
 * the V12 suite produces are ~349ms apart.
 *
 * ── WHY THE BUDGETS ARE ASSERTED AND NOT ONLY PRINTED ──────────────────────
 *
 * The brief is "each spec counts taps AND asserts the outcome". A printed
 * number is not an assertion. Each budget below is the number of taps the job
 * needs when no screen is in the way, taken from the flow's own definition in
 * the bug-hunt brief and, where V12 already had one, from that budget. They
 * are WRITTEN, not measured: the browser is unavailable in the session that
 * wrote this file (`chromium.launch` fails with `spawn EPERM` under the
 * sandbox), so every budget here is a ceiling derived from the steps, and
 * every spec prints the measured count next to it. If a measured number is
 * below its budget, tighten the budget to the measurement rather than leaving
 * slack; if it is above, the screen has too many steps and the "Too many
 * steps" section of `docs/BUGS.md` says which ones to cut.
 */

import { expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'

import { loginAdmin, loginClient, loginTeam, loggedInContext } from '../helpers/auth'
import { loadTestEnv } from '../helpers/env'
import { sessionEvent } from '../v12-seed.mjs'
import {
  eventCodeFromUrl,
  installTapCounter,
  markOnboarded,
  readTapLog,
  readTaps,
  resetTaps,
  waitForScreen,
} from '../v12-taps.mjs'

/** The counter merges events inside 250ms. Deliberate taps go slower than that. */
export const TAP_PACING_MS = 300

/**
 * The tap budget for each job, with the flow it belongs to.
 *
 * A budget is a statement about the SCREEN, not about the person: the same job
 * done by a slower hand is the same number of taps.
 *
 * EVERY NUMBER HERE IS DERIVED FROM THE FLOW'S OWN STEP LIST, NOT MEASURED.
 * The browser is unavailable in the session that wrote this file (`chromium.launch`
 * fails with `spawn EPERM` under the sandbox), so each budget is the minimum
 * number of taps the job needs plus at most one, and each spec prints the
 * measured count next to it. When the flows first run for real, TIGHTEN these
 * to the measurement — slack is what lets a regression through.
 */
export const TAP_BUDGET = {
  /** (a) Calls tab + dial = 2. */
  'call-next-family': 2,
  /** (a) Calls tab + one outcome button = 2. */
  'log-outcome-one-tap': 2,
  /** (a) Calls tab + Coming + 2 stepper taps + date + time + mode + Save = 8. */
  'coming-with-travel': 9,
  /** (a) Calls tab + open the sheet + a time chip + Save call back = 5. */
  'call-back': 5,
  /** (b) Auto-fill + Confirm = 2. */
  'rooms-autofill-confirm': 3,
  /** (b) occupant + Move + target room = 3. */
  'rooms-move-guest': 4,
  /** (b) Share with another single + the partner = 2. */
  'rooms-share-two-singles': 3,
  /** (c) the family's row + the one commit = 2. */
  'checkin-a-family': 3,
  /** (d) Take photo + Choose photo + Confirm delivery = 3. */
  'hamper-photo-proof': 4,
  /** (e) Mark arrived (the Now card) + the sheet's commit = 2. */
  'arrival-met': 3,
  /** (e) Search + Save departure = 2; the fields are typing, not taps. */
  'departure-walkup': 3,
  /** (f) the header's search button + the field + the result row = 3. */
  'find-guest': 3,
  /** (g) not budgeted through `finishCounting` — the client flow asserts a shape. */
  'client-read-only': 3,
  /** (h) one tap on the event row = 1. */
  'admin-switch-event': 2,
  /** (h) Choose file = 1; the preview needs no tap. */
  'admin-import-preview': 2,
} as const

export type FlowId = keyof typeof TAP_BUDGET

/** Everything a flow spec needs: an authenticated page and the test event. */
export interface FlowSession {
  context: BrowserContext
  page: Page
  code: string
  eventId: string
  eventName: string
}

export type FlowRole = 'team' | 'client' | 'admin'

/**
 * The event the ACCESS CODES actually sign into, with a hard refusal to write
 * to the live event.
 *
 * See the file header for why this is not `E2E_EVENT_ID`.
 */
export async function testEvent(): Promise<{ id: string; code: string; name: string }> {
  const event = await sessionEvent()

  if (!event.codesShareEvent) {
    throw new Error(
      `E2E_TEAM_CODE and E2E_CLIENT_CODE name different events ` +
        `(${event.teamCodeEventId} vs ${event.clientCodeEventId}). The client flow cannot be ` +
        `measured against the same data as the staff flows.`,
    )
  }

  const env = loadTestEnv()
  if (env.E2E_EVENT_ID !== event.id) {
    // Loud, because every reader of `.env.test` will otherwise assume
    // `E2E_EVENT_ID` is the event under test. It is not, and it never was.
    process.stdout.write(
      `[flow] NOTE: E2E_EVENT_ID (${env.E2E_EVENT_ID}) is NOT the event the access codes ` +
        `sign into (${event.code} / ${event.id}). These flows use the codes' event.\n`,
    )
  }

  const live = [process.env.SMOKE_EVENT_CODE, process.env.NEXT_PUBLIC_LIVE_EVENT_CODE]
    .filter((code): code is string => Boolean(code))
    .map((code) => code.trim().toUpperCase())

  if (live.includes(event.code.toUpperCase())) {
    throw new Error(
      `refusing to run writing flows against "${event.code}" — that is a live/production event, ` +
        `and these flows write rows the database will not let anyone delete ` +
        `(call_attempts freeze on first write; delivery_proofs are insert-only). ` +
        `Point E2E_TEAM_CODE at a test event.`,
    )
  }

  return { id: event.id, code: event.code, name: event.name }
}

/**
 * A fresh authenticated context with the tap counter and the onboarding flags
 * armed BEFORE the first navigation.
 *
 * Order matters: `markOnboarded` and `installTapCounter` both use
 * `addInitScript`, which only applies to documents loaded after it is called.
 * `loggedInContext` builds the context and the page without navigating, so
 * calling them here means the very first screen is measured and unobstructed.
 */
export async function openSession(browser: Browser, role: FlowRole): Promise<FlowSession> {
  const state =
    role === 'admin'
      ? await loginAdmin(browser)
      : role === 'client'
        ? await loginClient(browser)
        : await loginTeam(browser)

  const { context, page } = await loggedInContext(browser, state)
  await markOnboarded(context)
  await installTapCounter(context)

  const event = await testEvent()
  await expectV2Shell(page, event.code)

  return { context, page, code: event.code, eventId: event.id, eventName: event.name }
}

/**
 * FAIL LOUDLY IF THE v2 SHELL IS NOT ACTIVE.
 *
 * Every flow in this directory drives the SPEC-V3 screens — the five-tab bar,
 * `Auto-fill N families`, `Take photo`, the `Name, last 4 digits, or room`
 * search box. None of those exist in the v1 tree, which is what
 * `NEXT_PUBLIC_UI` unset (the default) serves. Without this check a mis-set
 * environment produces eight specs' worth of "element not found" and reads as
 * eight broken features rather than one unset variable.
 *
 * `/find` is the probe because it is a v2-only route: the v1 tree has no
 * `find` directory at all, so under v1 it lands on the event's not-found page
 * while the header still renders and looks healthy.
 */
export async function expectV2Shell(page: Page, code: string): Promise<void> {
  await page.goto(`/${code}/find`, { waitUntil: 'domcontentloaded' })

  const missing = await notFoundNote(page).count()
  if (missing > 0) {
    throw new Error(
      `/${code}/find is not a page in this build, so the v2 shell is not active. ` +
        `These flows drive the SPEC-V3 screens and must run against it: start the server with ` +
        `NEXT_PUBLIC_UI=v2 (see the gate in .brain/SPEC-V3.md) and run the flows project again.`,
    )
  }
}


/** Go to an event-scoped screen and wait until it is genuinely readable. */
export async function open(page: Page, code: string, path = ''): Promise<void> {
  await page.goto(`/${code}${path ? `/${path}` : ''}`, { waitUntil: 'domcontentloaded' })
  await waitForScreen(page)
}

/** The event code from the URL the session actually landed on. */
export function codeFromUrl(page: Page): string {
  return eventCodeFromUrl(page.url())
}

/**
 * A tap a finger would make, paced so the counter cannot merge it with the
 * previous one.
 *
 * `locator.click()` and not `page.mouse.click()`: it carries Playwright's
 * actionability checks (visible, stable, enabled, receives events), which is
 * exactly what is wanted here — a control that is not tappable should fail
 * with Playwright's reason, not be missed silently. It still produces a real
 * `click` event, which is what the counter listens for.
 */
export async function tap(page: Page, target: Locator, label: string): Promise<void> {
  await target.waitFor({ state: 'visible', timeout: 30_000 })
  await target.click()
  await page.waitForTimeout(TAP_PACING_MS)
  void label
}

/** `tap` for a control that must also be enabled — a disabled tap proves nothing. */
export async function tapEnabled(page: Page, target: Locator, label: string): Promise<void> {
  await target.waitFor({ state: 'visible', timeout: 30_000 })
  expect(
    await target.isEnabled(),
    `"${label}" is on screen but disabled — a tap on it cannot do the job`,
  ).toBe(true)
  await tap(page, target, label)
}

/**
 * Tap a bottom-bar tab by its label.
 *
 * Resolved from the bar's own anchors rather than by text, because a label can
 * also appear in the header as a title or a back-control name and Playwright's
 * strict mode then refuses the tap.
 */
export async function tapTab(page: Page, label: string): Promise<void> {
  const bar = page.locator('nav[aria-label="Sections"] a')
  await bar.first().waitFor({ state: 'visible', timeout: 30_000 })
  const href = await bar.evaluateAll(
    (links, wanted) =>
      links
        .find((a) => (a.textContent ?? '').trim().toLowerCase() === wanted.toLowerCase())
        ?.getAttribute('href') ?? null,
    label,
  )
  if (!href) {
    const seen = await bar.evaluateAll((links) => links.map((a) => (a.textContent ?? '').trim()))
    throw new Error(`no "${label}" tab in the bottom bar — the bar has ${JSON.stringify(seen)}`)
  }
  await tap(page, page.locator(`nav[aria-label="Sections"] a[href="${href}"]`).first(), `${label} tab`)
  await waitForScreen(page)
}

/** The round search control in every v3 screen header opens Find. */
export function headerSearch(page: Page): Locator {
  return page.locator('a[aria-label="Find a guest"], header a[href$="/find"]').first()
}

/**
 * The "not found" screens, which is what a tab pointing at a route with no page
 * behind it renders. Named so a spec can tell "the screen is empty" from "the
 * screen does not exist".
 *
 * Two messages, because Next renders whichever boundary is nearest: a URL
 * inside a matched event layout (`/{event}/hospitality`, no page at that
 * segment) gets `(staff)/[eventCode]/not-found.tsx` — "That page is not here" —
 * while a URL whose first segment matches nothing gets the ROOT
 * `src/app/not-found.tsx` — "We could not find that page". A spec that only
 * knew one of the two would call a 404 a missing element.
 */
export function notFoundNote(page: Page): Locator {
  return page.getByText(/That page is not here|We could not find that page/)
}

/**
 * Start counting from here. Call it immediately before the job's first tap.
 *
 * A full document load resets the counter (the init script re-runs), so a spec
 * must `resetTaps` AFTER its last `page.goto` and drive the job with
 * client-side navigation — which is what a real runner does anyway, because
 * every tab and every row is a Next `<Link>`.
 */
export async function startCounting(page: Page): Promise<void> {
  await resetTaps(page)
}

/**
 * Assert the job stayed inside its budget, print the real number, and dump the
 * tap log on failure so the extra taps can be attributed to a screen.
 */
export async function finishCounting(
  page: Page,
  flow: FlowId,
  outcome: string,
): Promise<number> {
  const taps = await readTaps(page)
  const budget = TAP_BUDGET[flow]

  expect(
    taps,
    `the tap counter is not installed (readTaps returned -1), so "${flow}" was not measured`,
  ).toBeGreaterThan(0)

  process.stdout.write(`[flow] ${flow}: ${taps} taps (budget ${budget}) — ${outcome}\n`)

  if (taps > budget) {
    const log = await readTapLog(page)
    expect(
      taps,
      `${flow} took ${taps} taps; the budget is ${budget}, because ${outcome}.\n` +
        `Every tap it made:\n  ${log.join('\n  ')}\n` +
        `Too many steps is a finding, not a flake — see the "Too many steps" section of docs/BUGS.md.`,
    ).toBeLessThanOrEqual(budget)
  }

  return taps
}

/**
 * The regression test every flow spec opens with: the bottom-bar tab that is
 * supposed to reach this job must actually land on a screen.
 *
 * WHY THIS IS A SEPARATE ASSERTION AND NOT A PRECONDITION. A tab whose href
 * has no page behind it renders perfectly and 404s on tap, which reads as
 * "the feature was never built" rather than "the tab points at the wrong
 * path" — and every flow spec that navigated through it would report a
 * missing element instead of the real fault. Checking it on its own names the
 * fault.
 */
export async function expectTabOpens(
  page: Page,
  code: string,
  tab: string,
  expectUrl: RegExp,
): Promise<void> {
  await open(page, code)
  await tapTab(page, tab)
  await expect(
    notFoundNote(page),
    `the "${tab}" tab led to a route with no page behind it`,
  ).toHaveCount(0)
  await expect(page).toHaveURL(expectUrl)
}
