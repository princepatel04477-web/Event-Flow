/**
 * V12 — the tap budgets and the structural sweep, WITHOUT the Playwright runner.
 *
 * WHY THIS EXISTS. The V-series recorded that the Playwright RUNNER hangs in this
 * repository before it evaluates any spec, and built `scripts/feel-baseline.mjs`
 * and `scripts/tabs-reach.mjs` to drive the BROWSER API directly instead. That
 * claim was re-tested in this session — see DECISIONS.md, V12, for what happened
 * — but the reason this file exists is not the runner's health. It is that
 * "a named task with a number" is the deliverable, and a number you cannot
 * produce is not a number. This drives the browser, runs THE SAME task
 * definitions the spec asserts against (`e2e/v12-tasks.mjs`), and prints one
 * line per task with its budget and its measured tap count.
 *
 * WHAT IT DOES THAT THE SPEC CANNOT. It seeds its own fixtures
 * (`e2e/v12-seed.mjs`), so it is runnable on a fresh checkout with no runner and
 * no manual database work, and it prints the numbers to stdout where they can be
 * pasted into a report.
 *
 * IT IS MEASURED AGAINST A PRODUCTION BUILD, NOT `next dev`. Turbopack's first
 * compile of a route costs seconds and would land inside whichever task hit it
 * first. Build and start it separately:
 *
 *   $env:NEXT_PUBLIC_UI='v2'; npm run build
 *   $env:NEXT_PUBLIC_UI='v2'; npx next start -p 3100
 *   node scripts/tap-budget.mjs --base http://localhost:3100
 *
 * The `NEXT_PUBLIC_UI` flag MUST be exported when `next start` runs, not only
 * when `next build` does: `src/proxy.ts` reads it at request time through
 * `getUiVersion()`. Starting without it serves v1 and every v2 screen 404s.
 */
import { readFileSync } from 'node:fs'

import { chromium } from 'playwright'

import { seed, unseed, FAMILIES, sessionEvent } from '../e2e/v12-seed.mjs'
import {
  installTapCounter,
  markOnboarded,
  readTapLog,
} from '../e2e/v12-taps.mjs'
import {
  task1CallNextFamily,
  task2LogOutcome,
  task2SheetOutcome,
  task3FindFamily,
  task4GiveRoom,
  task6UndoRoom,
  task5HamperProof,
  task7MarkArrived,
  task8ClientRoom,
  task9ClientArrivals,
  probeStructure,
} from '../e2e/v12-tasks.mjs'

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

const BASE = arg('--base', process.env.E2E_BASE_URL ?? 'http://localhost:3000')
const SKIP_SEED = argv.includes('--no-seed')

function parseEnv(file) {
  const out = {}
  try {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq <= 0) continue
      out[t.slice(0, eq).trim()] = t
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, '')
    }
  } catch {
    /* reported by the login step failing */
  }
  return out
}

const env = { ...parseEnv('.env.local'), ...parseEnv('.env.test') }

const results = []
const record = (task, budget, measured, detail) => {
  // `null` is NOT "zero taps" and it is not "over budget": it is "there is no
  // control to tap". Reporting it as 0 would make the impossible task look like
  // the cheapest one in the file.
  const impossible = measured === null
  const over = impossible ? null : measured > budget
  results.push({ task, budget, measured, detail, over, impossible })
  const verdict = impossible
    ? 'NOT POSSIBLE (no such control)'
    : over
      ? `OVER by ${measured - budget}`
      : 'within budget'
  console.log(
    `  ${task.padEnd(46)} budget<=${String(budget).padStart(2)}  taps=${
      impossible ? '--' : String(measured).padStart(2)
    }  ${verdict}`,
  )
  if (detail) console.log(`      ${detail}`)
}

/** Run one measurement, never letting a failure take the whole run down. */
async function attempt(label, fn) {
  try {
    return await fn()
  } catch (e) {
    console.log(`  [${label}] NOT COMPLETED: ${e instanceof Error ? e.message.split('\n')[0] : e}`)
    return null
  }
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

async function loginTeamState(browser) {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 } })
  const page = await context.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Access code').fill(env.E2E_TEAM_CODE)
  await page.getByRole('button', { name: /enter event|checking/i }).click()
  await page.waitForURL(/\/pick-staff/, { timeout: 45_000 })
  await page
    .getByRole('button', { name: env.E2E_TEAM_STAFF, exact: false })
    .first()
    .waitFor({ state: 'visible', timeout: 20_000 })
  await page.getByRole('button', { name: env.E2E_TEAM_STAFF, exact: false }).first().click()
  await page.waitForURL((u) => !u.pathname.startsWith('/pick-staff'), { timeout: 45_000 })
  const landing = page.url()
  const teamName = env.E2E_TEAM_STAFF
  const state = await context.storageState()
  await context.close()
  return { state, landing, teamName }
}

async function loginClientState(browser) {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 } })
  const page = await context.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Access code').fill(env.E2E_CLIENT_CODE)
  await page.getByRole('button', { name: /enter event|checking/i }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 45_000 })
  const landing = page.url()
  const state = await context.storageState()
  await context.close()
  return { state, landing }
}

/**
 * A returning device with the tap counter armed.
 *
 * `baseURL` IS NOT OPTIONAL HERE. `e2e/tasks` and the task definitions navigate
 * with `page.goto('/${code}/...')`, and Playwright only resolves a relative URL
 * against the context's `baseURL` — the one Playwright's own config supplies
 * automatically and a hand-built context does not. Without it every task failed
 * with "Cannot navigate to invalid URL", which is how this line came to exist.
 */
async function readyContext(browser, state) {
  const context = await browser.newContext({
    baseURL: BASE,
    storageState: state,
    viewport: { width: 360, height: 800 },
  })
  await markOnboarded(context)
  await installTapCounter(context)
  return { context, page: await context.newPage() }
}

// ---------------------------------------------------------------------------

const run = async () => {
  const event = await sessionEvent()
  console.log(`\n=== V12 tap budgets ===`)
  console.log(`base   ${BASE}`)
  console.log(`event  ${event.code} (${event.name}) — from the TEAM ACCESS CODE, not E2E_EVENT_ID`)
  console.log(`       E2E_EVENT_ID names a different event; see DECISIONS.md V12.`)
  console.log(`team   ${env.E2E_TEAM_STAFF}`)

  let fixtures = null
  if (!SKIP_SEED) {
    fixtures = await seed()
    console.log(`seed   ${fixtures.families.ids ? Object.keys(fixtures.families.ids).length : 0} families, room ${fixtures.roomNumber}, deliverable ${fixtures.deliverableId}`)
    console.log(`       arrivals dated ${fixtures.today} (the DEVICE's local today)`)
  }

  const code = event.code
  const browser = await chromium.launch()
  console.log(`chromium ${browser.version()}\n`)

  const team = await loginTeamState(browser)
  console.log(`signed in; landed ${new URL(team.landing).pathname}`)

  // Warm every route once so a cold server render is never inside a number.
  {
    const { context, page } = await readyContext(browser, team.state)
    for (const path of ['rsvp/queue', 'rsvp/campaigns', 'hospitality/rooms', 'hospitality/deliveries', 'logistics/arrivals', 'find']) {
      await page.goto(`${BASE}/${code}/${path}`, { waitUntil: 'domcontentloaded' }).catch(() => {})
      await page.waitForLoadState('networkidle').catch(() => {})
    }
    await context.close()
    console.log('warmed all staff routes\n')
  }

  // --- Job 1 ------------------------------------------------------------
  {
    const { context, page } = await readyContext(browser, team.state)
    const r = await attempt('T1 call next family', () =>
      task1CallNextFamily(page, code, FAMILIES.call),
    )
    record('T1 call the next family (cold start)', 2, r?.taps ?? null, r?.detail ?? '')
    await context.close()
  }

  // --- Job 2 ------------------------------------------------------------
  {
    const { context, page } = await readyContext(browser, team.state)
    const r = await attempt('T2 log outcome', () => task2LogOutcome(page, code))
    record('T2 log that call\u2019s outcome', 2, r?.taps ?? null, r?.detail ?? '')
    await context.close()
  }
  {
    const { context, page } = await readyContext(browser, team.state)
    const r = await attempt('T2b sheeted outcome', () => task2SheetOutcome(page, code))
    if (r) {
      console.log(
        `\n  (for comparison, not a budget) T2 via the Coming sheet: ${r.taps} taps — ${r.detail}\n`,
      )
    }
    await context.close()
  }

  // --- Job 3 ------------------------------------------------------------
  {
    const { context, page } = await readyContext(browser, team.state)
    const r = await attempt('T3 find Sharma', () => task3FindFamily(page, code, FAMILIES.search))
    record('T3 find the family "Sharma"', 3, r?.taps ?? null, r?.detail ?? '')
    await context.close()
  }

  // --- Job 4 and Job 6 (same page state) --------------------------------
  {
    const { context, page } = await readyContext(browser, team.state)
    const r4 = await attempt('T4 give a room', () => task4GiveRoom(page, code, FAMILIES.room))
    record('T4 give a family a room', 4, r4?.taps ?? null, r4?.detail ?? '')
    if (r4) {
      const r6 = await attempt('T6 undo', () => task6UndoRoom(page))
      record('T6 undo task 4', 1, r6?.taps ?? null, r6?.detail ?? '')
    } else {
      record('T6 undo task 4', 1, null, 'task 4 did not reach an undo offer')
    }
    await context.close()
  }

  // --- Job 5 ------------------------------------------------------------
  {
    const { context, page } = await readyContext(browser, team.state)
    const photo = readFileSync('e2e/fixtures/proof-test.jpg')
    const r = await attempt('T5 hamper proof', () => task5HamperProof(page, code, photo))
    record('T5 mark a hamper delivered, with a photo', 4, r?.taps ?? null, r?.detail ?? '')
    await context.close()
  }

  // --- Job 7 ------------------------------------------------------------
  {
    const { context, page } = await readyContext(browser, team.state)
    const r = await attempt('T7 mark arrived', () => task7MarkArrived(page, code))
    record('T7 mark an arrival arrived', 3, r?.taps ?? null, r?.detail ?? '')
    console.log(`      tap log: ${JSON.stringify(await readTapLog(page).catch(() => []))}`)
    await context.close()
  }

  // --- Jobs 8 and 9 (client) --------------------------------------------
  const client = await loginClientState(browser)
  console.log(`\nclient signed in; landed ${new URL(client.landing).pathname}`)
  {
    const { context, page } = await readyContext(browser, client.state)
    const r = await attempt('T8 client room', () =>
      task8ClientRoom(page, code, FAMILIES.clientRoom),
    )
    record('T8 find my own room number (client)', 3, r?.taps ?? null, r?.detail ?? '')
    await context.close()
  }
  {
    const { context, page } = await readyContext(browser, client.state)
    const r = await attempt('T9 client arrivals', () =>
      task9ClientArrivals(page, code, FAMILIES.clientArrival),
    )
    record('T9 see who is arriving today (client)', 2, r?.taps ?? null, r?.detail ?? '')
    await context.close()
  }

  // --- Structural sweep --------------------------------------------------
  console.log(`\n=== structural sweep (V2 routes, team session) ===`)
  const ROUTES = [
    { path: '', bottomBar: true },
    { path: 'rsvp/queue', bottomBar: true },
    { path: 'rsvp/campaigns', bottomBar: false },
    { path: 'guests/list', bottomBar: true },
    { path: 'hospitality/rooms', bottomBar: true },
    { path: 'hospitality/deliveries', bottomBar: true },
    { path: 'logistics/arrivals', bottomBar: true },
    { path: 'find', bottomBar: false },
    { path: 'help', bottomBar: false },
  ]

  const structural = []
  {
    const { context, page } = await readyContext(browser, team.state)
    for (const route of ROUTES) {
      const url = `${BASE}/${code}${route.path ? `/${route.path}` : ''}`
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded' })
        await page.waitForLoadState('networkidle').catch(() => {})
        await page.waitForTimeout(1_200)
        const probe = await probeStructure(page, { bottomBarDestination: route.bottomBar })
        const worst = probe.results.slice(0, 4)
        structural.push({ ...route, findings: probe.results.length })
        console.log(
          `  /${route.path || '(home)'}`.padEnd(34) +
            ` controls=${String(probe.actionableCount).padStart(3)}` +
            ` body=${probe.bodyFontSize}px` +
            ` findings=${probe.results.length}`,
        )
        for (const f of worst) console.log(`      [${f.rule}] ${f.detail}`)
      } catch (e) {
        console.log(`  /${route.path} FAILED: ${e instanceof Error ? e.message.split('\n')[0] : e}`)
      }
    }
    // The client's own two screens, which are read-only and have no bar.
    await context.close()
  }

  {
    const { context, page } = await readyContext(browser, client.state)
    for (const path of ['guests', 'find']) {
      try {
        await page.goto(`${BASE}/${code}/${path}`, { waitUntil: 'domcontentloaded' })
        await page.waitForLoadState('networkidle').catch(() => {})
        await page.waitForTimeout(4_000)
        const probe = await probeStructure(page, { bottomBarDestination: false })
        console.log(
          `  client /${path}`.padEnd(34) + ` controls=${String(probe.actionableCount).padStart(3)} body=${probe.bodyFontSize}px findings=${probe.results.length}`,
        )
        for (const f of probe.results.slice(0, 4)) console.log(`      [${f.rule}] ${f.detail}`)
      } catch (e) {
        console.log(
          `  client /${path} NOT SWEPT: ${e instanceof Error ? e.message.split('\n')[0] : e}` +
            ` — the client's guest list never stops navigating, so there is no stable DOM to sweep`,
        )
      }
    }
    await context.close()
  }

  await browser.close()

  if (!SKIP_SEED) await unseed().catch(() => {})

  const failed = results.filter((r) => r.over === true || r.impossible)
  console.log(`\n=== result ===`)
  console.log(`  budgets within: ${results.filter((r) => r.over === false).length}/${results.length}`)
  for (const r of failed) {
    console.log(
      `  FAIL ${r.task}: ${
        r.impossible
          ? `the task cannot be done at all — ${r.detail.split('.')[0]}`
          : `${r.measured} taps vs ${r.budget}`
      }`,
    )
  }
  console.log(`\n[obvious-json] ${JSON.stringify({ event: event.code, results, structural })}`)
}

run().catch((e) => {
  console.error(`FAILED: ${e instanceof Error ? e.stack ?? e.message : String(e)}`)
  process.exitCode = 1
})
