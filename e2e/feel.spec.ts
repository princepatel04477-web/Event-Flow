import { expect, test, type Page, type Response } from '@playwright/test'

import { loggedInContext, loginTeam } from './helpers/auth'
import { db, EVENT_ID } from './helpers/db'

const ITERATIONS = 5

const PROFILES = [
  { name: 'venue-wifi', latencyMs: 300, downMbps: 1.5, upMbps: 0.75 },
  { name: '4g', latencyMs: 150, downMbps: 4, upMbps: 2 },
] as const

const ROUTES = [
  { label: 'home', path: (code: string) => `/${code}` },
  { label: 'rsvp-queue', path: (code: string) => `/${code}/rsvp/queue` },
  { label: 'guest-list', path: (code: string) => `/${code}/guests/list` },
  { label: 'rooms', path: (code: string) => `/${code}/hospitality/rooms` },
  { label: 'arrivals', path: (code: string) => `/${code}/logistics/arrivals` },
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
  route: RouteLabel
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

test.describe('feel baseline', () => {
  test.describe.configure({ mode: 'serial', timeout: 20 * 60 * 1000 })

  test('prints M1-M5 for five routes under venue Wi-Fi and 4G', async ({ browser }) => {
    const code = await eventCode()
    const counts = await seededCounts()
    console.log(`[feel] event=${code} seed=${counts.guests} SEED-543 guests families=${counts.families}`)
    expect(counts.guests, 'SEED-543 data must be present before measuring real rows').toBe(543)
    expect(counts.families, 'full-scale family count must be present').toBeGreaterThanOrEqual(238)

    const summaries: Summary[] = []

    for (const profile of PROFILES) {
      const { context, page } = await loggedInContext(browser, await loginTeam(browser))
      await throttle(page, profile)

      await warmRoutes(page, code)
      console.log(`[feel] warmed all routes before timing (${profile.name})`)

      for (const route of ROUTES) {
        const routeSamples: Record<'M1' | 'M2' | 'M3', Sample[]> = { M1: [], M2: [], M3: [] }
        for (let i = 0; i < ITERATIONS; i += 1) {
          const sample = await measureRoute(page, code, route)
          routeSamples.M1.push(sample.m1)
          routeSamples.M2.push(sample.m2)
          routeSamples.M3.push(sample.m3)
        }
        summaries.push(summarize(profile.name, route.label, 'M1', routeSamples.M1))
        summaries.push(summarize(profile.name, route.label, 'M2', routeSamples.M2))
        summaries.push(summarize(profile.name, route.label, 'M3', routeSamples.M3))

        const m5Samples: Sample[] = []
        for (let i = 0; i < ITERATIONS; i += 1) {
          m5Samples.push(await measureBackRestore(page, code, route.path(code)))
        }
        summaries.push(summarize(profile.name, route.label, 'M5', m5Samples))
      }

      const m4Samples: Sample[] = []
      for (let i = 0; i < ITERATIONS; i += 1) m4Samples.push(await measureSave(page, code))
      for (const route of ROUTES) summaries.push(summarize(profile.name, route.label, 'M4', m4Samples))

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
  })
})
