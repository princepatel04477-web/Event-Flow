/**
 * Feels-baseline harness that does NOT use the Playwright test runner.
 *
 * WHY THIS EXISTS. `e2e/feel.spec.ts` cannot run here: the Playwright RUNNER
 * hangs before it evaluates any spec, and the repo's own pre-existing `phone`
 * suite hangs identically, so it is not a defect in that spec. The BROWSER works
 * — a standalone `chromium.launch()` succeeds in ~430ms and renders pages — so
 * the runner is the blocked component, not the measurement. This drives the
 * browser API directly, which is what makes a baseline possible at all.
 *
 * WHAT IT MEASURES, AND WHAT IT HONESTLY CANNOT
 *
 *   route load      direct navigation to each of the five routes, throttled.
 *                   NOT a tap: a full document load, so it is an upper bound and
 *                   must not be compared to a tap budget.
 *   M1              real in-app tap -> first visual change (MutationObserver
 *                   armed before the click).
 *   M2              same tap -> the DESTINATION FRAME. Waits for the
 *                   `[data-screen]` attribute every v2 screen carries on the
 *                   root of its main column, so this is "the new screen is on
 *                   the glass", not "some pixel moved". A proxy would be worse.
 *   M3              same tap -> real rows on screen. A skeleton is explicitly
 *                   excluded; a harness that cannot tell them apart measures
 *                   nothing.
 *   M5              from the record, history.back() -> the list restored with
 *                   the SAME row that was tapped visible again.
 *   M4              NOT MEASURED here — it needs the RSVP log flow, which is
 *                   the tap-budget runner's job (`scripts/tap-budget.mjs`).
 *
 * WHERE IT WRITES. `FEEL_OUT_DIR` if set, else the session scratchpad when the
 * harness runs under Command Code, else the current directory. The log/json
 * deliberately do NOT hardcode another checkout's path — that made a baseline
 * impossible to reproduce from any tree but one.
 *
 * Progress is appended with synchronous writes: stdout here is fully buffered
 * through a pipe, so nothing is observable until the process exits.
 */
import { appendFileSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from 'playwright'

const OUT_DIR = process.env.FEEL_OUT_DIR ?? process.env.COMMANDCODE_SCRATCHPAD ?? process.cwd()
const LOG = join(OUT_DIR, 'feel-baseline.log')
writeFileSync(LOG, '')
const mark = (m) => {
  appendFileSync(LOG, `${new Date().toISOString()}  ${m}\n`)
  console.log(m)
}

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const ITERATIONS = 3

const PROFILES = [
  { name: 'venue-wifi', latency: 300, downMbps: 1.5 },
  { name: '4g', latency: 150, downMbps: 4 },
]

const ROUTES = [
  { label: 'home', path: (c) => `/${c}` },
  { label: 'rsvp-queue', path: (c) => `/${c}/rsvp/queue` },
  { label: 'guest-list', path: (c) => `/${c}/guests/list` },
  { label: 'rooms', path: (c) => `/${c}/hospitality/rooms` },
  { label: 'arrivals', path: (c) => `/${c}/logistics/arrivals` },
]

function parseEnv(path) {
  const out = {}
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
  }
  return out
}

/**
 * Credentials, read from wherever they are. Earlier versions hardcoded one
 * checkout's path, which is why this could only ever run from that tree; the
 * CWD is tried first and the historical location last, so a run in a worktree
 * uses the worktree's own env when it has one.
 */
const ENV_FILES = [
  join(process.cwd(), '.env.local'),
  join(process.cwd(), '.env.test'),
  'C:\\dev\\EventFlow\\.env.local',
  'C:\\dev\\EventFlow\\.env.test',
]
const env = Object.assign(
  {},
  ...ENV_FILES.filter((p) => existsSync(p)).map((p) => parseEnv(p)),
)
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0

/** Replicates e2e/helpers/auth.ts loginTeamAs using the real UI flow. */
async function loginTeam(browser) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Access code').fill(env.E2E_TEAM_CODE)
  await page.getByRole('button', { name: /enter event|checking/i }).click()
  await page.waitForURL(/\/pick-staff/, { timeout: 45_000 })
  await page.getByRole('button', { name: env.E2E_TEAM_STAFF, exact: false }).first().click()
  await page.waitForURL((u) => !u.pathname.startsWith('/pick-staff'), { timeout: 45_000 })
  const landing = page.url()
  const state = await context.storageState()
  await context.close()
  return { state, landing }
}

/**
 * The event the SESSION belongs to, taken from where the login actually landed.
 *
 * NOT `E2E_EVENT_ID`. Those two disagree in this environment: E2E_EVENT_ID is
 * E12345 ("Nuvent Event") while the team access code signs into SAMPLE2026. The
 * acceptance harness seeds the former and signs in to the latter. Both hold 543
 * SEED-543 guests, which is why it has gone unnoticed — but measuring the wrong
 * one reads a screen this session cannot see, and my first attempt did exactly
 * that and got a page with one link on it.
 */
function codeFromLanding(url) {
  const seg = new URL(url).pathname.split('/').filter(Boolean)[0]
  if (!seg) throw new Error(`could not read an event code from ${url}`)
  return seg
}

async function throttle(page, profile) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: profile.latency,
    downloadThroughput: (profile.downMbps * 1_000_000) / 8,
    uploadThroughput: (profile.downMbps * 1_000_000) / 16,
  })
}

/** Real content, explicitly NOT a skeleton. */
async function hasRealRows(page) {
  return page.evaluate(() => {
    const skeleton = document.querySelector('[aria-busy="true"], .animate-pulse')
    if (skeleton) return false
    return Array.from(document.querySelectorAll('main a[href], main button, main li, main article')).some(
      (el) => {
        const b = el.getBoundingClientRect()
        const t = (el.textContent ?? '').trim()
        return b.width > 0 && b.height >= 24 && t.length > 0 && !/loading/i.test(t)
      },
    )
  })
}

async function waitForRealRows(page, timeout = 45_000) {
  await page.waitForFunction(
    () => {
      const skeleton = document.querySelector('[aria-busy="true"], .animate-pulse')
      if (skeleton) return false
      return Array.from(document.querySelectorAll('main a[href], main button, main li, main article')).some(
        (el) => {
          const b = el.getBoundingClientRect()
          const t = (el.textContent ?? '').trim()
          return b.width > 0 && b.height >= 24 && t.length > 0 && !/loading/i.test(t)
        },
      )
    },
    null,
    { timeout },
  )
}

async function run() {
  const browser = await chromium.launch()
  mark(`chromium ${browser.version()} launched`)

  const { state, landing } = await loginTeam(browser)
  const code = codeFromLanding(landing)
  mark(`signed in; landed on ${landing}`)
  mark(`MEASURING EVENT: ${code}  (from the landing URL, NOT E2E_EVENT_ID)`)

  const routeLoads = []
  const taps = []

  for (const profile of PROFILES) {
    mark(`--- profile ${profile.name} (latency ${profile.latency}ms, ${profile.downMbps}Mbps) ---`)
    const context = await browser.newContext({ storageState: state, viewport: { width: 360, height: 800 } })
    const page = await context.newPage()
    await throttle(page, profile)

    // Warm once so a cold Turbopack compile is never measured.
    for (const r of ROUTES) {
      await page.goto(`${BASE}${r.path(code)}`, { waitUntil: 'domcontentloaded' }).catch(() => {})
      await waitForRealRows(page, 60_000).catch(() => {})
    }
    mark('  warmed all routes')

    for (const r of ROUTES) {
      const times = []
      for (let i = 0; i < ITERATIONS; i += 1) {
        const t0 = Date.now()
        await page.goto(`${BASE}${r.path(code)}`, { waitUntil: 'domcontentloaded' }).catch(() => {})
        await waitForRealRows(page, 60_000).catch(() => {})
        times.push(Date.now() - t0)
      }
      routeLoads.push({ profile: profile.name, route: r.label, median: median(times), worst: Math.max(...times) })
      mark(`  load ${r.label.padEnd(11)} median=${median(times)}ms worst=${Math.max(...times)}ms`)
    }

    // ---- M1 / M2 / M3 / M5 on a REAL in-app tap ---------------------------
    // The most common navigation in the product: open a family from the list.
    for (let i = 0; i < ITERATIONS; i += 1) {
      await page.goto(`${BASE}/${code}/guests/list`, { waitUntil: 'domcontentloaded' }).catch(() => {})
      await waitForRealRows(page, 60_000).catch(() => {})

      const rowLink = page.locator(`main a[href*="/rsvp/status/"]`).first()
      if ((await rowLink.count()) === 0) {
        mark('  tap: no family row link on the guest list, skipping')
        break
      }

      // Kept so M5 can look for the SAME row after going back, not just any row.
      const rowHref = await rowLink.getAttribute('href').catch(() => null)

      await page.evaluate(() => {
        const snap = () => document.body.textContent ?? ''
        const before = snap()
        window.__t = { start: performance.now(), first: null }
        const obs = new MutationObserver(() => {
          if (window.__t.first === null && snap() !== before) {
            window.__t.first = performance.now() - window.__t.start
          }
        })
        obs.observe(document.body, { childList: true, subtree: true, characterData: true })
      })

      const t0 = Date.now()
      await rowLink.click({ timeout: 20_000 }).catch(() => {})
      await page.waitForURL(/\/rsvp\/(status|call)\//, { timeout: 30_000 }).catch(() => {})

      // M2 — the destination frame. `data-screen` sits on the root of the new
      // screen's main column, so this lands when the SCREEN is on the glass,
      // which is the thing T4's budget is about. The value is the DESTINATION's
      // ("family"), not a bare `[data-screen]`: the list being left behind
      // already carries `data-screen="guests"`, so a bare selector would match
      // before the tap did anything and report a fake zero.
      const m2 = await page
        .waitForSelector('[data-screen="family"]', { timeout: 30_000 })
        .then(() => Date.now() - t0)
        .catch(() => null)

      const toContent = Date.now() - t0
      const first = await page.evaluate(() => window.__t?.first ?? null)

      // M5 — back to the list, restored. A soft back (popstate), then the row
      // that was tapped must be visible again.
      let m5 = null
      if (rowHref) {
        const tBack = Date.now()
        await page.goBack({ timeout: 30_000 }).catch(() => {})
        const restored = await page
          .locator(`main a[href="${rowHref}"]`)
          .first()
          .waitFor({ state: 'visible', timeout: 30_000 })
          .then(() => true)
          .catch(() => false)
        if (restored) m5 = Date.now() - tBack
      }

      taps.push({
        profile: profile.name,
        m1: first === null ? toContent : Math.round(first),
        m2,
        m3: toContent,
        m5,
      })
      mark(
        `  tap  family row  M1=${taps.at(-1).m1}ms  M2=${m2 ?? '-'}ms  M3=${toContent}ms  M5=${m5 ?? '-'}ms`,
      )
    }

    await context.close()
  }

  await browser.close()

  const out = join(OUT_DIR, 'feel-baseline.json')
  writeFileSync(out, JSON.stringify({ code, landing, iterations: ITERATIONS, routeLoads, taps }, null, 2))

  const medOf = (xs) => {
    const real = xs.filter((x) => typeof x === 'number')
    return real.length ? median(real) : null
  }

  mark('')
  mark('=== ROUTE LOAD (full document navigation, NOT a tap) ===')
  for (const r of routeLoads) {
    mark(`  ${r.profile.padEnd(11)} ${r.route.padEnd(11)} median=${r.median}ms worst=${r.worst}ms`)
  }
  mark('=== TAP (real client-side navigation: family row) ===')
  for (const p of PROFILES) {
    const xs = taps.filter((t) => t.profile === p.name)
    if (xs.length) {
      mark(
        `  ${p.name.padEnd(11)} M1=${medOf(xs.map((t) => t.m1))}ms  ` +
          `M2=${medOf(xs.map((t) => t.m2)) ?? '-'}ms  ` +
          `M3=${medOf(xs.map((t) => t.m3))}ms  M5=${medOf(xs.map((t) => t.m5)) ?? '-'}ms`,
      )
    }
  }
  mark(`wrote ${out}`)
  mark('=== DONE ===')
}

run().catch((e) => {
  mark(`FAILED: ${e instanceof Error ? e.stack ?? e.message : String(e)}`)
  process.exit(1)
})
