import { expect, test, type Page, type Response } from '@playwright/test'

import { loggedInContext, loginTeam } from './helpers/auth'
import { db, EVENT_ID } from './helpers/db'
import { installTapCounter, markOnboarded } from './v12-taps.mjs'
import { probeStructure } from './v12-tasks.mjs'

const ITERATIONS = 5

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * V12 (extends V1) — DOES IT FEEL INSTANT?
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * V1 wrote this file to REPORT M1–M5. V12 makes it ASSERT, which is the whole
 * difference between a baseline and a contract: a regression in any of these
 * numbers now fails the build instead of appearing in a log nobody reads.
 *
 * ── THE BUDGETS, AND WHERE EACH ONE COMES FROM ───────────────────────────
 *
 * Every number below is `docs/INTERACTION-CONTRACT.md`'s Budgets table. None of
 * them was chosen here, and none of them was softened to match a measurement —
 * the contract says so in its own words, and `docs/FEEL-BASELINE.md` records the
 * 2026-09-21 measurement each one is a target AGAINST:
 *
 *   M1  tap → first visual change      ≤ 100 ms    (T1's rule; measured 2258–3172 ms)
 *   M2  tap → destination frame        ≤ 300 ms    (unmeasured; set from `arrivals` at 1323 ms)
 *   M3  tap → real rows, CACHED        ≤ 150 ms    (one frame plus a fade; nothing met it at baseline)
 *   M3  tap → real rows, UNCACHED      ≤ 2000 ms   (met by 2 of 4 routes at baseline; `rooms` was 6303 ms)
 *   M4  one action's server time       ≤ 500 ms    (unchanged from the proposal; needs server-side timing)
 *   M5  back → list restored, cached   ≤ 150 ms    (same reasoning as M3-cached)
 *
 * A route that is over budget FAILS. That is the point of the file. When M3
 * fails on `rooms`, the message names `rooms`, and the next session has its
 * worklist — which is worth more than a green line that hides a six-second wait.
 *
 * ── WHAT THE ONBOARDING FLAG IS DOING HERE ───────────────────────────────
 *
 * A fresh Playwright context is a fresh DEVICE, and `FirstRunCards` paints a
 * full-screen overlay on one. Every measurement in this file is taken through a
 * context marked onboarded (and with the per-screen hints dismissed), because
 * otherwise M1 would be timing the onboarding cards rather than the tap. See
 * `e2e/v12-taps.mjs` for the full reasoning.
 *
 * ── WHY THE ROUTES ARE THE v2 ONES ───────────────────────────────────────
 *
 * These are the five screens the new UI actually ships, and two of V1's five
 * are not them: `/{code}/guests/list` was a 404 under v2 when AMENDMENTS §3 was
 * written (it is a shim now), and the event's home is not `/{code}` for a
 * management runner — `page.tsx` redirects them to `/{code}/rsvp/campaigns`
 * before anything renders. Measuring a redirect target as if it were the home
 * understates the home and never measures the screen people land on.
 */

const BUDGET = {
  /** M1 — T1. The tap owns the first 100ms. */
  m1: 100,
  /** M2 — the destination's structural frame. */
  m2: 300,
  /** M3 on a list the client already had. */
  m3Cached: 150,
  /** M3 on a list that has to come from the server. */
  m3Uncached: 2000,
  /** M4 — a single action's total server time. */
  m4: 500,
  /** M5 — back, with the list restored from cache and no refetch. */
  m5: 150,
} as const

const PROFILES = [
  { name: 'venue-wifi', latencyMs: 300, downMbps: 1.5, upMbps: 0.75 },
  { name: '4g', latencyMs: 150, downMbps: 4, upMbps: 2 },
] as const

const ROUTES = [
  { label: 'rsvp-queue', path: (code: string) => `/${code}/rsvp/queue` },
  { label: 'guest-list', path: (code: string) => `/${code}/guests/list` },
  { label: 'rooms', path: (code: string) => `/${code}/hospitality/rooms` },
  { label: 'arrivals', path: (code: string) => `/${code}/logistics/arrivals` },
  { label: 'hamper-run', path: (code: string) => `/${code}/hospitality/deliveries` },
] as const


type ProfileName = (typeof PROFILES)[number]['name']
type RouteLabel = (typeof ROUTES)[number]['label']
type MetricName = 'M1' | 'M2' | 'M3' | 'M4' | 'M5'

interface Sample {
  ms: number
  requests: number
  bytes: number
  refetched?: boolean
}

interface Summary {
  profile: ProfileName
  /** A route label, or a named action for a metric that is not route-scoped. */
  route: string
  metric: MetricName
  medianMs: number
  worstMs: number
  requests: number
  bytes: number
  refetched?: boolean
}

async function eventCode(): Promise<string> {
  const { data } = await db.from('events').select('code').eq('id', EVENT_ID).maybeSingle()
  if (!data?.code) throw new Error(`E2E_EVENT_ID ${EVENT_ID} does not resolve to an event`)
  return data.code
}

async function seededCounts(): Promise<{ guests: number; families: number }> {
  const [{ count: guests, error: guestErr }, { count: families, error: familyErr }] =
    await Promise.all([
      db
        .from('guests')
        .select('*', { count: 'exact', head: true })
        .eq('event_id', EVENT_ID)
        .ilike('full_name', 'SEED-543%'),
      db.from('guest_groups').select('*', { count: 'exact', head: true }).eq('event_id', EVENT_ID),
    ])
  if (guestErr) throw new Error(`count SEED-543 guests: ${guestErr.message}`)
  if (familyErr) throw new Error(`count guest families: ${familyErr.message}`)
  return { guests: guests ?? 0, families: families ?? 0 }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function summarize(
  profile: ProfileName,
  route: RouteLabel,
  metric: MetricName,
  samples: Sample[],
): Summary {
  return {
    profile,
    route,
    metric,
    medianMs: median(samples.map((s) => s.ms)),
    worstMs: Math.max(...samples.map((s) => s.ms)),
    requests: Math.round(median(samples.map((s) => s.requests))),
    bytes: Math.round(median(samples.map((s) => s.bytes))),
    refetched: samples.some((s) => s.refetched),
  }
}

async function throttle(page: Page, profile: (typeof PROFILES)[number]): Promise<void> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: profile.latencyMs,
    downloadThroughput: (profile.downMbps * 1_000_000) / 8,
    uploadThroughput: (profile.upMbps * 1_000_000) / 8,
  })
}

async function stopThrottle(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  })
}

function watchNetwork(page: Page) {
  let requests = 0
  let bytes = 0
  const requestHandler = () => {
    requests += 1
  }
  const responseHandler = async (response: Response) => {
    const length = response.headers()['content-length']
    if (length && Number.isFinite(Number(length))) {
      bytes += Number(length)
      return
    }
    try {
      bytes += (await response.body()).byteLength
    } catch {
      // Redirects and cached responses can have no readable body. Count the
      // request and leave bytes at the conservative value available.
    }
  }
  page.on('request', requestHandler)
  page.on('response', responseHandler)
  return async () => {
    await page.waitForTimeout(100)
    page.off('request', requestHandler)
    page.off('response', responseHandler)
    return { requests, bytes }
  }
}

async function warmRoutes(page: Page, code: string): Promise<void> {
  for (const route of ROUTES) {
    await page.goto(route.path(code))
    await page.waitForLoadState('domcontentloaded')
    await waitForFrame(page)
    await waitForRealContent(page)
  }
}

async function waitForFrame(page: Page, started?: number): Promise<number> {
  const start = started ?? (await page.evaluate(() => performance.now()))
  await expect(page.locator('main h1, main h2, header h1, header h2').first()).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.locator('main')).not.toContainText(/loading/i, { timeout: 30_000 })
  return Math.round((await page.evaluate(() => performance.now())) - start)
}

async function waitForRealContent(page: Page, started?: number): Promise<number> {
  const start = started ?? (await page.evaluate(() => performance.now()))
  const result = await page.waitForFunction(() => {
    const skeletons = Array.from(
      document.querySelectorAll(
        '[aria-busy="true"], [data-loading="true"], .animate-pulse, [class*="skeleton"], [class*="LoadingRows"]',
      ),
    ).filter((el) => {
      const box = (el as HTMLElement).getBoundingClientRect()
      return box.width > 0 && box.height > 0
    })

    const candidates = Array.from(
      document.querySelectorAll('main a[href], main button, main article, main li, main [role="listitem"]'),
    ).filter((el) => {
      const node = el as HTMLElement
      const box = node.getBoundingClientRect()
      const text = (node.textContent ?? '').trim()
      const busy = node.closest('[aria-busy="true"], .animate-pulse, [data-loading="true"]')
      return box.width > 0 && box.height >= 24 && text.length > 0 && !busy && !/loading/i.test(text)
    })

    return candidates.length > 0
      ? { realRows: candidates.length, skeletons: skeletons.length }
      : false
  }, null, { timeout: 30_000 })

  // `waitForFunction` resolves to the truthy object above, so the union with
  // `false` is a type artifact of the assertion, not a real possibility: the
  // predicate only returns `false` to keep polling, and polling never settles
  // on `false`. Narrow before reading the counts.
  const counts = (await result.jsonValue()) as { realRows: number; skeletons: number }
  expect(counts.realRows, 'real rows must be distinguishable from skeleton placeholders').toBeGreaterThan(0)
  return Math.round((await page.evaluate(() => performance.now())) - start)
}

async function armVisualWatcher(page: Page): Promise<void> {
  await page.evaluate(() => {
    const region = document.querySelector('main') ?? document.body
    const nav = document.querySelector('nav') ?? document.body
    const snapshot = () => `${region.textContent ?? ''}|${nav.textContent ?? ''}|${location.pathname}`
    ;(window as Window & { __feelFirstChange?: Promise<number> }).__feelFirstChange = new Promise(
      (resolve) => {
        const start = performance.now()
        const first = snapshot()
        const done = () => {
          observer.disconnect()
          resolve(Math.round(performance.now() - start))
        }
        const observer = new MutationObserver(() => {
          if (snapshot() !== first) done()
        })
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true,
        })
        const tick = () => {
          if (snapshot() !== first) done()
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      },
    )
  })
}

async function firstVisualChange(page: Page): Promise<number> {
  return page.evaluate(() => {
    const win = window as Window & { __feelFirstChange?: Promise<number> }
    if (!win.__feelFirstChange) throw new Error('visual watcher was not armed before the tap')
    return win.__feelFirstChange
  })
}

async function clickRoute(page: Page, code: string, targetPath: string): Promise<number> {
  const source = targetPath === `/${code}` ? `/${code}/guests/list` : `/${code}`
  await page.goto(source)
  await page.waitForLoadState('domcontentloaded')
  await waitForRealContent(page)

  const target = page.locator(`a[href="${targetPath}"], a[href$="${targetPath}"]`).first()
  await expect(target, `visible navigation link to ${targetPath}`).toBeVisible({ timeout: 20_000 })
  await armVisualWatcher(page)
  const started = await page.evaluate(() => performance.now())
  await target.click()
  return started
}

async function measureRoute(page: Page, code: string, route: (typeof ROUTES)[number]): Promise<{
  m1: Sample
  m2: Sample
  m3: Sample
  network: Pick<Sample, 'requests' | 'bytes'>
}> {
  const stopNetwork = watchNetwork(page)
  const started = await clickRoute(page, code, route.path(code))
  const [m1Ms, m2Ms, m3Ms] = await Promise.all([
    firstVisualChange(page),
    waitForFrame(page, started),
    waitForRealContent(page, started),
  ])
  const network = await stopNetwork()
  return {
    m1: { ms: m1Ms, ...network },
    m2: { ms: m2Ms, ...network },
    m3: { ms: m3Ms, ...network },
    network,
  }
}

async function firstFamilyLink(page: Page) {
  return page
    .locator('main a[href*="/guests/"], main a[href*="/rsvp/status/"], main a[href*="/rsvp/call/"]')
    .filter({ hasText: /SEED-543|[A-Za-z]/ })
    .first()
}

async function measureSave(page: Page, code: string): Promise<Sample> {
  await page.goto(`/${code}/rsvp/queue`)
  await page.waitForLoadState('domcontentloaded')
  await waitForRealContent(page)
  const link = await firstFamilyLink(page)
  await expect(link, 'family link from RSVP queue').toBeVisible({ timeout: 30_000 })
  await link.click()
  await page.waitForLoadState('domcontentloaded')
  await waitForRealContent(page)

  const option = page.getByRole('radio').first().or(page.getByRole('button', { name: /coming|not coming|maybe|no answer/i }).first())
  if (await option.isVisible({ timeout: 5_000 }).catch(() => false)) await option.click()

  const save = page.getByRole('button', { name: /save/i }).first()
  await expect(save, 'Save button on RSVP log screen').toBeVisible({ timeout: 20_000 })
  const stopNetwork = watchNetwork(page)
  const started = await page.evaluate(() => performance.now())
  await save.click()
  await expect(page.locator('body')).toContainText(/saved|done|queue|updated/i, { timeout: 30_000 })
  const ms = Math.round((await page.evaluate(() => performance.now())) - started)
  return { ms, ...(await stopNetwork()) }
}

async function measureBackRestore(page: Page, code: string, routePath: string): Promise<Sample> {
  await page.goto(routePath)
  await page.waitForLoadState('domcontentloaded')
  await waitForRealContent(page)

  const link = await firstFamilyLink(page)
  await expect(link, `drill-in link on ${routePath}`).toBeVisible({ timeout: 30_000 })
  await link.click()
  await page.waitForLoadState('domcontentloaded')
  await waitForRealContent(page)

  const stopNetwork = watchNetwork(page)
  const started = await page.evaluate(() => performance.now())
  await page.goBack()
  await waitForRealContent(page)
  const network = await stopNetwork()
  const ms = Math.round((await page.evaluate(() => performance.now())) - started)
  const refetched = network.requests > 0
  return { ms, ...network, refetched }
}

/**
 * A fresh context that is a RETURNING device.
 *
 * `loggedInContext` builds its own context, so the onboarding flag has to be
 * installed on it after the fact — and it has to be installed BEFORE the first
 * navigation of the measurement, or `FirstRunCards` paints over the screen and
 * M1 measures the onboarding cards. `addInitScript` is injected into every
 * document from that point on, including the ones the taps navigate to.
 */
async function measuredContext(
  browser: Parameters<typeof loginTeam>[0],
  profile: (typeof PROFILES)[number],
) {
  const { context, page } = await loggedInContext(browser, await loginTeam(browser))
  await markOnboarded(context)
  await installTapCounter(context)
  await throttle(page, profile)
  return { context, page }
}

test.describe('feel baseline', () => {
  test.describe.configure({ mode: 'serial', timeout: 20 * 60 * 1000 })

  test('M1-M5 on every new route, under venue Wi-Fi and 4G, asserted against the contract', async ({
    browser,
  }) => {
    const code = await eventCode()
    const counts = await seededCounts()
    console.log(`[feel] event=${code} seed=${counts.guests} SEED-543 guests families=${counts.families}`)
    expect(counts.guests, 'SEED-543 data must be present before measuring real rows').toBe(543)
    expect(counts.families, 'full-scale family count must be present').toBeGreaterThanOrEqual(238)

    const summaries: Summary[] = []
    const failures: string[] = []

    for (const profile of PROFILES) {
      const { context, page } = await measuredContext(browser, profile)

      await warmRoutes(page, code)
      console.log(`[feel] warmed all routes before timing (${profile.name})`)

      for (const route of ROUTES) {
        const routeSamples: Record<'M1' | 'M2' | 'M3', Sample[]> = { M1: [], M2: [], M3: [] }

        // M3 is measured TWICE on purpose. The contract's cached budget is
        // 150ms and its uncached budget is 2000ms, and a single number cannot
        // say which one applies. Pass 1 runs against a cold cache (the route has
        // just been loaded from scratch by `clickRoute`'s source navigation);
        // pass 2 runs immediately after, inside TanStack's 30s stale window, so
        // the rows are already in the cache and the slow branch is unreachable.
        // Grading a cached hit against the uncached budget would ratify a
        // regression; grading a cold miss against the cached budget would fail
        // every screen on the first run.
        const uncached: Sample[] = []
        for (let i = 0; i < ITERATIONS; i += 1) {
          const sample = await measureRoute(page, code, route)
          routeSamples.M1.push(sample.m1)
          routeSamples.M2.push(sample.m2)
          uncached.push(sample.m3)
        }
        const cached: Sample[] = []
        for (let i = 0; i < ITERATIONS; i += 1) {
          const sample = await measureRoute(page, code, route)
          cached.push(sample.m3)
        }

        const m1 = summarize(profile.name, route.label, 'M1', routeSamples.M1)
        const m2 = summarize(profile.name, route.label, 'M2', routeSamples.M2)
        const m3cold = summarize(profile.name, route.label, 'M3', uncached)
        const m3warm = summarize(profile.name, route.label, 'M3', cached)
        summaries.push(m1, m2, m3cold, m3warm)

        const m5Samples: Sample[] = []
        for (let i = 0; i < ITERATIONS; i += 1) {
          m5Samples.push(await measureBackRestore(page, code, route.path(code)))
        }
        const m5 = summarize(profile.name, route.label, 'M5', m5Samples)
        summaries.push(m5)

        // ---- the assertions, one metric at a time ----
        const grade = (metric: string, row: Summary, budget: number, note = '') => {
          const line =
            `${profile.name} ${route.label} ${metric}: median ${row.medianMs}ms (worst ${row.worstMs}ms) ` +
            `against ${budget}ms${note ? ` — ${note}` : ''}`
          if (row.medianMs > budget) failures.push(line)
        }

        grade('M1 tap-to-visual-feedback', m1, BUDGET.m1, 'T1: the tap owns the first 100ms')
        grade('M2 tap-to-destination-frame', m2, BUDGET.m2)
        grade('M3 tap-to-content (uncached)', m3cold, BUDGET.m3Uncached)
        grade('M3 tap-to-content (cached)', m3warm, BUDGET.m3Cached)
        if (m5.refetched) {
          // A refetch on Back is a T4 failure in its own right. It is reported
          // as a failed budget rather than a soft note because the number is
          // meaningless without it: a 40ms "restore" that went to the server is
          // not a restore.
          failures.push(
            `${profile.name} ${route.label} M5 back-to-list REFETCHED on Back (requests=${m5.requests}) — T4: no route transition may re-fetch data the client already had`,
          )
        } else {
          grade('M5 back-to-list (no refetch)', m5, BUDGET.m5)
        }
      }

      // ---- M4: one action's total server time ----
      //
      // Reported ONCE per profile, not once per route. The metric is about the
      // write, and the write is the RSVP outcome — the same action whichever
      // screen the runner came from. The V1 version of this loop copied the same
      // five samples onto all five route labels, which made one number look like
      // five independent measurements. `route` is deliberately typed as a plain
      // string here so a label outside `ROUTES` is not a type error.
      const m4Samples: Sample[] = []
      for (let i = 0; i < ITERATIONS; i += 1) m4Samples.push(await measureSave(page, code))
      const m4: Summary = { ...summarize(profile.name, ROUTES[0].label, 'M4', m4Samples), route: 'rsvp-status (the write itself)' }
      summaries.push(m4)
      if (m4.medianMs > BUDGET.m4) {
        failures.push(
          `${profile.name} M4 one action's total server time: median ${m4.medianMs}ms ` +
            `(worst ${m4.worstMs}ms) against ${BUDGET.m4}ms — measured on the RSVP outcome save`,
        )
      }

      await stopThrottle(page)
      await context.close()
    }

    console.log('\n[feel] summary')
    for (const row of summaries) {
      console.log(
        `[feel] ${row.profile.padEnd(10)} ${row.route.padEnd(11)} ${row.metric} median=${row.medianMs}ms worst=${row.worstMs}ms requests=${row.requests} bytes=${row.bytes}` +
          (row.metric === 'M5' ? ` refetched=${row.refetched ? 'yes' : 'no'}` : ''),
      )
    }
    console.log(`[feel-json] ${JSON.stringify(summaries)}`)

    // EVERY failure at once, not the first. The value of this test is the
    // worklist it leaves behind, and stopping at the first over-budget metric
    // would hide the other four.
    expect(
      failures,
      `${failures.length} feel budget(s) missed. Each line names the profile, the route, the ` +
        `metric and the number it missed by:\n` +
        failures.map((f) => `      • ${f}`).join('\n'),
    ).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// THE STRUCTURAL SWEEP — every route in the new group
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The brief's structural rules, checked against the rendered DOM of every route
 * in the new group:
 *
 *   - every interactive element is at least 44 × 44 CSS px
 *   - computed body font-size is at least 16px
 *   - a visible back control, or the route is a bottom-bar destination
 *   - no more than 7 primary tappable actions in the main column
 *   - no horizontal scroll at 360px
 *   - no element containing the strings "pax", "deliverable", "extraction",
 *     "travel leg"
 *   - at most one row of filter controls, and none above the first content row
 *   - no full-screen loading state on a route whose data is already cached
 *
 * The probes live in `e2e/v12-tasks.mjs` so this sweep and
 * `scripts/tap-budget.mjs` measure the same things; the reasoning for the
 * `bottomBarDestination` flag is in that file. The last rule is the only one
 * that needs a second visit, and it is checked here by loading each route twice
 * and asserting the second load never shows a full-page `Loading` state.
 */
const SWEEP_ROUTES = [
  { path: '', label: 'home', bar: true },
  { path: 'rsvp/queue', label: 'rsvp/queue (Calls tab)', bar: true },
  { path: 'rsvp/campaigns', label: 'rsvp/campaigns (cold-start destination)', bar: false },
  { path: 'guests/list', label: 'guests/list (Guests tab)', bar: true },
  { path: 'hospitality/rooms', label: 'hospitality/rooms (Rooms tab)', bar: true },
  { path: 'hospitality/deliveries', label: 'hospitality/deliveries', bar: true },
  { path: 'logistics/arrivals', label: 'logistics/arrivals (Travel tab)', bar: true },
  { path: 'find', label: 'find (header search)', bar: false },
  { path: 'help', label: 'help (header ?)', bar: false },
] as const

test.describe('structure — every route in the new group', () => {
  test.describe.configure({ mode: 'serial', timeout: 10 * 60 * 1000 })

  for (const route of SWEEP_ROUTES) {
    test(`${route.label}`, async ({ browser }) => {
      const { context, page } = await loggedInContext(browser, await loginTeam(browser))
      await markOnboarded(context)

      const url = `/${await eventCode()}${route.path ? `/${route.path}` : ''}`

      // Second visit, so anything cached already is: this is the rule about not
      // showing a full-screen loading state for data the client already had.
      await page.goto(url)
      await page.waitForLoadState('networkidle').catch(() => {})
      await page.goto(url)
      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(600)

      const loading = await page
        .locator('text=/^Loading…?$/')
        .first()
        .isVisible()
        .catch(() => false)
      expect(
        loading,
        `${route.label}: showed a full-screen loading state on a route the client had already ` +
          `visited (T4 — navigation is instant or it is not navigation)`,
      ).toBe(false)

      const probe = await probeStructure(page, { bottomBarDestination: route.bar })

      expect(
        probe.results,
        `${route.label} (${probe.path}) breaks ${probe.results.length} structural rule(s):\n` +
          probe.results.map((r: { rule: string; detail: string }) => `      • [${r.rule}] ${r.detail}`).join('\n'),
      ).toEqual([])
      expect(probe.bodyFontSize, `${route.label}: body font-size must be >= 16px`).toBeGreaterThanOrEqual(16)

      await context.close()
    })
  }
})
