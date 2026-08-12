import { test, expect } from '@playwright/test'

import { loggedInContext } from './helpers/auth'
import { db, EVENT_ID } from './helpers/db'
import { loadTestEnv } from './helpers/env'

/**
 * Per-route timing harness for the Supabase round-trip work.
 *
 * NOT part of the scored acceptance run (e2e/report.mjs scores tier0-2 only).
 * This measures, it does not assert correctness — the only expectation is that
 * a route actually rendered, so a redirect to /login cannot be recorded as a
 * fast page.
 *
 * Run it against a PRODUCTION build (`next build && next start`), never `next
 * dev`: dev compiles routes on first hit, which swamps the thing being
 * measured. The numbers are dev-machine → Supabase Seoul (~320ms RTT), so they
 * are a valid before/after comparison on THIS machine, not a production figure.
 *
 *   npm run build && npx next start -p 3100
 *   E2E_BASE_URL=http://localhost:3100 npx playwright test e2e/perf.spec.ts --project=phone
 *
 * `PERF_LABEL=before|after` tags the output file so two runs can be diffed.
 *
 * METRIC: wall-clock to the `load` event, not TTFB. This app has 11
 * `loading.tsx` files, so every route streams — the server flushes a shell
 * immediately and the data arrives later. `responseStart - requestStart`
 * therefore measures shell delivery and stayed flat at ~17ms on routes whose
 * data took 240ms, which would have read as "already fast". TTFB is still
 * recorded alongside, for reference only.
 */

const env = loadTestEnv()
const LABEL = process.env.PERF_LABEL ?? 'run'

/**
 * The event each session actually lands on after login.
 *
 * NOT resolved from E2E_EVENT_ID. The admin credentials and the team access
 * code belong to DIFFERENT events (admin -> SHARMA26, team code -> SAMPLE2026),
 * so pointing the team session at the admin's event measured a not-found
 * render for an event that session cannot see — 17ms, which read as "team is
 * already fast" when the real figure was ~240ms. Derive the code from where
 * login lands so every sample is a page the session can genuinely render.
 */
function codeFromUrl(url: string): string {
  const seg = new URL(url).pathname.split('/').filter(Boolean)[0]
  if (!seg) throw new Error(`login landed on ${url}, which carries no event code`)
  return seg
}

/** Sanity check that the admin event from .env.test still resolves. */
async function adminEventCode(): Promise<string> {
  const { data } = await db.from('events').select('code').eq('id', EVENT_ID).maybeSingle()
  if (!data) throw new Error(`E2E_EVENT_ID ${EVENT_ID} does not resolve to an event.`)
  return data.code as string
}

/** Routes worth timing, by the session type that can actually reach them. */
const ADMIN_ROUTES = [
  { name: 'dashboard', path: '' },
  { name: 'guests', path: '/guests' },
  { name: 'queue', path: '/queue' },
  { name: 'rooms', path: '/rooms' },
  { name: 'deliveries', path: '/deliveries' },
  { name: 'arrivals', path: '/arrivals' },
  { name: 'fleet', path: '/fleet' },
  { name: 'logistics', path: '/logistics' },
  { name: 'review', path: '/review' },
  { name: 'export', path: '/export' },
]

const TEAM_ROUTES = [
  { name: 'dashboard', path: '' },
  { name: 'guests', path: '/guests' },
  { name: 'queue', path: '/queue' },
  { name: 'rooms', path: '/rooms' },
  { name: 'deliveries', path: '/deliveries' },
]

type Sample = {
  session: 'admin' | 'team'
  route: string
  coldMs: number
  warmMs: number
  supabaseCalls: number
}

const samples: Sample[] = []

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

/**
 * Time one navigation, returning server-side TTFB rather than full load.
 *
 * `responseStart - requestStart` is the number this work moves: it is the time
 * the server spent resolving identity and querying Supabase. Full load time
 * folds in asset transfer and hydration, which no amount of round-trip removal
 * will change, and would mask the effect.
 */
async function timeRoute(
  page: import('@playwright/test').Page,
  url: string,
): Promise<{ ms: number; ttfbMs: number; status: number }> {
  const startedAt = Date.now()
  const res = await page.goto(url, { waitUntil: 'load' })
  const ms = Date.now() - startedAt
  const ttfbMs = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
    return Math.round(nav.responseStart - nav.requestStart)
  })
  return { ms, ttfbMs, status: res?.status() ?? 0 }
}

for (const session of ['admin', 'team'] as const) {
  const routes = session === 'admin' ? ADMIN_ROUTES : TEAM_ROUTES

  test(`perf :: ${session} routes`, async ({ browser }) => {
    test.setTimeout(180_000)

    // Log in inline rather than via the shared helpers, because the landing
    // URL is the only reliable source of "which event does this session own",
    // and the helpers discard it. `/` does not redirect to an event.
    const loginCtx = await browser.newContext()
    const loginPage = await loginCtx.newPage()
    if (session === 'admin') {
      await loginPage.goto('/admin/login')
      await loginPage.getByLabel('Email').fill(env.E2E_USER_A_EMAIL)
      await loginPage.getByLabel('Password').fill(env.E2E_USER_A_PASSWORD)
      await loginPage.getByRole('button', { name: /sign in|enter event/i }).click()
      await loginPage.waitForURL((u) => !u.pathname.startsWith('/admin/login'), { timeout: 30_000 })
    } else {
      await loginPage.goto('/login')
      await loginPage.getByLabel('Access code').fill(env.E2E_TEAM_CODE)
      await loginPage.getByRole('button', { name: /enter event|checking/i }).click()
      await loginPage.waitForURL(/\/pick-staff/, { timeout: 30_000 })
      await loginPage.getByRole('button', { name: env.E2E_TEAM_STAFF, exact: false }).first().click()
      await loginPage.waitForURL((u) => !u.pathname.startsWith('/pick-staff'), { timeout: 30_000 })
    }
    const landedUrl = loginPage.url()
    const state = JSON.stringify(await loginCtx.storageState())
    await loginCtx.close()

    const { context, page } = await loggedInContext(browser, state)

    // An admin may land on a chooser rather than an event; fall back to the
    // event named in .env.test, which is the one the acceptance suite seeds.
    let code: string
    try {
      code = codeFromUrl(landedUrl)
    } catch {
      code = await adminEventCode()
    }
    if (code === 'admin' || code === 'login') code = await adminEventCode()
    console.log(`[perf-harness] ${session} session event = ${code} (landed ${landedUrl})`)

    // Count Supabase REST/RPC/auth requests the SERVER cannot make on the
    // client's behalf. Server-side calls are invisible here, so this counts
    // only browser-originated ones — the server count comes from the
    // [perf] logs on the server console. Kept so a regression that moves work
    // INTO the browser is still visible.
    let supabaseCalls = 0
    page.on('request', (req) => {
      if (req.url().includes('.supabase.co')) supabaseCalls += 1
    })

    for (const route of routes) {
      const url = `/${code}${route.path}`
      supabaseCalls = 0

      // Cold: cache-busted so the 30s TTL cache cannot serve it, and taken
      // as a median of 3 — the first request against a freshly-started server
      // includes connection setup and was a 7s outlier in testing.
      const coldSamples: number[] = []
      let cold = await timeRoute(page, `${url}?cb=warmup`)
      for (let i = 0; i < 3; i += 1) {
        cold = await timeRoute(page, `${url}?cb=${Date.now()}-${i}`)
        coldSamples.push(cold.ms)
      }
      const coldMs = median(coldSamples)

      // The page must have RENDERED the route asked for. Any redirect —
      // /login, /pick-staff, or a bounce to another tab — produces a tiny
      // TTFB that would be recorded as a fast page. That is the single
      // easiest way for this harness to report a comfortable lie.
      const landed = new URL(page.url()).pathname.replace(/\/$/, '')
      const wanted = url.split('?')[0].replace(/\/$/, '')
      expect(landed, `${session} ${route.name} must render, not redirect`).toBe(wanted)

      // Warm: same URL repeatedly, so any TTL-cached read is served from
      // memory. Median of 3 for the same reason.
      const warmSamples: number[] = []
      let warm = await timeRoute(page, url)
      for (let i = 0; i < 3; i += 1) {
        warm = await timeRoute(page, url)
        warmSamples.push(warm.ms)
      }
      const warmMs = median(warmSamples)
      void warm

      samples.push({ session, route: route.name, coldMs, warmMs, supabaseCalls })
      console.log(
        `[perf-harness] ${session} ${route.name}: cold=${coldMs}ms warm=${warmMs}ms ` +
          `ttfb=${cold.ttfbMs}ms status=${cold.status} ` +
          `browserSupabaseCalls=${supabaseCalls}`,
      )
    }

    await context.close()
  })
}

test.afterAll(async () => {
  if (samples.length === 0) return

  const lines = [
    `# Per-route timing — ${LABEL}`,
    '',
    `Generated ${new Date().toISOString()}`,
    '',
    'Server TTFB (`responseStart - requestStart`), dev machine → Supabase Seoul.',
    '',
    '| Session | Route | Cold (load) | Warm (load) |',
    '|---|---|---:|---:|',
    ...samples.map(
      (s) => `| ${s.session} | ${s.route} | ${s.coldMs}ms | ${s.warmMs}ms |`,
    ),
  ]

  const { writeFileSync } = await import('node:fs')
  writeFileSync(`e2e/perf-${LABEL}.md`, lines.join('\n') + '\n')
  console.log(`[perf-harness] wrote e2e/perf-${LABEL}.md`)
})
