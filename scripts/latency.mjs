#!/usr/bin/env node
/**
 * PERF-MEASURE — `npm run latency`.
 *
 * WHAT THIS IS. The measurement SPEC-PERF §Measurement requires before and after
 * the local-first work: for each of the seven job screens, the four numbers that
 * decide whether the app "feels instant".
 *
 *   coldFirstLoad      a full document load on a cold HTTP cache   budget 2500 ms on 4g (informational)
 *   tapToFirstChange   the tap to the first pixel that moves       budget  120 ms
 *   tapToContent       the tap to a screen you can read            budget  120 ms
 *   saveToShownDone    the commit tap to the app saying "done"     budget  120 ms
 *
 * p50 and p95 over `--runs` runs (5 by default), under two network profiles
 * (4g: 150 ms RTT / 4 Mbps; venue-wifi: 300 ms RTT / 1.5 Mbps), on Chromium at
 * 390×844 with a 4× CPU throttle. Both are set through CDP, which is what a
 * cheap Android phone on venue Wi-Fi actually is once the laptop stops lying.
 *
 * ── WHY IT DRIVES THE BROWSER API AND NOT THE PLAYWRIGHT RUNNER ──────────────
 *
 * Two independent reasons, both recorded elsewhere in this repo:
 *
 *   1. The Playwright RUNNER has hung in this repository before it evaluates any
 *      spec (see `scripts/feel-baseline.mjs` and `scripts/tap-budget.mjs`), which
 *      is why those two scripts exist at all.
 *   2. This script has to run against a server the caller started. A runner
 *      brings its own `webServer` config and its own idea of the base URL;
 *      `BASE` is the one input SPEC-PERF names, so it is the one input this takes.
 *
 * `playwright` (the library the runner wraps) is a dependency of
 * `@playwright/test`, so this needs no manifest change.
 *
 * ── WHAT "WARM" MEANS HERE, AND WHY IT IS HONEST ────────────────────────────
 *
 * A tap is always measured from a screen the app has already rendered, to a
 * screen the app has already visited once in this session. That is a returning
 * handset, which is what a tap budget is about — see `e2e/v12-taps.mjs` for the
 * same argument about first-run cards. The donor screen is opened with a full
 * navigation first; the TAP itself is a real client-side navigation.
 *
 * The tap is delivered as `page.mouse.click()` at the control's centre, not as
 * `locator.click()`, so the browser's real pointer pipeline runs. That matters
 * beyond fidelity: `AppTabs` arms its prefetch on `pointerdown`, and a synthetic
 * click never fires one, so a synthetic tap measures a screen nobody can reach.
 *
 * ── THE ONE THING THIS CANNOT DO IN EVERY ENVIRONMENT ───────────────────────
 *
 * It needs a browser. Where `chromium.launch()` fails (a sandbox that refuses to
 * spawn a process with piped stdio fails it with `spawn EPERM`), this script
 * exits 2 with that sentence, having produced no numbers — it does not write a
 * report full of zeroes. The harness's arithmetic stays covered either way by
 * `tests/perf-core.test.ts`.
 *
 * USAGE
 *
 *   $env:NEXT_PUBLIC_UI='v2'; npm run build           # a production build, not next dev
 *   $env:NEXT_PUBLIC_UI='v2'; npx next start -p 3000  # NEXT_PUBLIC_UI must be set here too
 *   BASE=http://localhost:3000 npm run latency
 *
 *   npm run latency -- --runs 3 --profile 4g --screens "Rooms,Hampers"
 *   npm run latency -- --base https://nuvent-five.vercel.app --no-seed
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { dirname, resolve } from 'node:path'

import { chromium } from 'playwright'

import {
  CPU_THROTTLE_RATE,
  VIEWPORT,
  failures,
  formatMs,
  gradeRun,
  parseArgs,
  profilesFor,
  renderMarkdown,
  screenCatalog,
  selectScreens,
  summarize,
} from './perf-core.mjs'
import { FAMILIES, ROOM_NUMBER, seed, sessionEvent, unseed } from '../e2e/v12-seed.mjs'
import { markOnboarded } from '../e2e/v12-taps.mjs'

/**
 * THE TS RESOLVE HOOK.
 *
 * SPEC-PERF says to reuse `e2e/helpers/auth` and `.env.test` rather than write a
 * second login. Those helpers are TypeScript, and Node runs a `.ts` file by
 * stripping its types — which works — but their own imports are extensionless
 * (`from './env'`), and Node's ESM resolver needs a file extension.
 *
 * So a relative specifier with no extension is retried with one, in the order
 * TypeScript itself would try. Nothing else about resolution changes, and the
 * application's bundler is untouched: this affects this process only.
 *
 * It has to run before the dynamic import below, which is why that import is
 * dynamic. A static `import` is resolved during linking, before any module body
 * executes.
 */
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      for (const extension of ['.ts', '.tsx', '.mjs', '.js']) {
        try {
          return nextResolve(specifier + extension, context)
        } catch {
          /* the next extension is the next guess */
        }
      }
    }
    return nextResolve(specifier, context)
  },
})

/**
 * `e2e/helpers/auth.ts` is TypeScript, and Node runs a `.ts` file by stripping its
 * types — which needs Node 22.6 or newer. On an older runtime this is where it
 * fails, and a stack trace about "unknown file extension .ts" would read as a
 * broken harness rather than as a Node that is too old.
 */
let loginTeam
try {
  ;({ loginTeam } = await import('../e2e/helpers/auth.ts'))
} catch (error) {
  process.stderr.write(
    `latency: could not load e2e/helpers/auth.ts — ${firstLine(error)}\n` +
      'latency: this script reuses the acceptance suite\'s login, which is TypeScript.\n' +
      'latency: Node 22.6+ runs a .ts file directly (type stripping); check `node --version`.\n',
  )
  process.exit(2)
}

// ---------------------------------------------------------------------------
// Timeouts, in one place so a slow venue-Wi-Fi run is tuned in one place.
// ---------------------------------------------------------------------------

const NAV_TIMEOUT_MS = 60_000
const CONTENT_TIMEOUT_MS = 30_000
const UNDO_TIMEOUT_MS = 15_000
/** How long the in-page probe keeps polling for a number before giving up. */
const PROBE_DEADLINE_MS = 15_000

const HELP = `
npm run latency — measure the four budgets in SPEC-PERF §Measurement.

  --base URL        the running app. Default: $BASE, else http://localhost:3000
  --runs N          runs per metric, 1-50. Default 5
  --profile P       4g | venue-wifi | both. Default both
  --screens A,B     only these screens. Default all seven
  --out FILE        JSON output. Default e2e/latency-results.json
  --md FILE         markdown table. Default docs/LATENCY.md
  --no-seed         skip the V12 fixtures, and with them the two "save" metrics
  --help            this text

Screens: ${screenCatalog('EVENT').map((s) => s.label).join(', ')}

Measure against a PRODUCTION build (\`next build\` + \`next start\`), never
\`next dev\`: Turbopack's first compile of a route costs seconds and would land
inside whichever screen is measured first.
`.trim()

/**
 * `loginTeam` builds its own context and navigates with relative URLs
 * (`page.goto('/login')`), which Playwright resolves against the CONTEXT's
 * `baseURL` — a value the runner normally supplies and this script has to. A
 * proxy is the smallest way to supply it without forking the helper, and forking
 * it is exactly what "reuse the helper" is trying to avoid.
 */
function browserWithBase(browser, base) {
  return new Proxy(browser, {
    get(target, property) {
      if (property === 'newContext') {
        return (options = {}) => target.newContext({ baseURL: base, ...options })
      }
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

/**
 * The in-page probe, installed in EVERY document before the app's first script.
 *
 * It records three things, and each is in the page rather than in Node for the
 * same reason: asking Node "has anything changed yet?" costs a CDP round trip
 * per poll, so the answer would be the poll interval rather than the render.
 *
 *   first    the first visual change after a tap
 *   content  the frame the screen became readable (a heading, no visible
 *            skeleton, and either a real row or a line of text) — this is
 *            `waitForScreen` from `e2e/v12-taps.mjs`, the suite's existing
 *            definition of "readable", evaluated every animation frame
 *   rows     the first real row, reported but NOT gated, because a screen that
 *            paints its header and then waits two seconds for data would pass a
 *            heading-only budget
 *
 * Everything is measured from `origin()` — the moment of the tap once armed, and
 * the start of the document otherwise — so one probe serves the cold load and the
 * tap without either number borrowing the other's zero.
 *
 * `collectFromStart` is the switch between the two. A cold-load page needs the
 * frame loop running from document start; a warm page must NOT, because a
 * `querySelectorAll` plus a `getBoundingClientRect` per element every frame is a
 * layout thrash that would be charged to the tap being measured.
 */
function probeSource({ collectFromStart, deadlineMs }) {
  const w = window
  if (w.__lat) return

  const visible = (el) => {
    const box = el.getBoundingClientRect()
    return box.width > 0 && box.height > 0
  }
  const main = () => document.querySelector('main') ?? document.body
  const hasSkeleton = () =>
    Array.from(
      document.querySelectorAll(
        '[aria-busy="true"], [data-loading="true"], .animate-pulse, [class*="skeleton"], [class*="LoadingRows"]',
      ),
    ).some(visible)
  const rowCount = () =>
    Array.from(main().querySelectorAll('a[href], button, article, li, [role="listitem"]')).filter((el) => {
      const node = el
      const box = node.getBoundingClientRect()
      const text = (node.textContent ?? '').trim()
      const busy = node.closest('[aria-busy="true"], .animate-pulse, [data-loading="true"]')
      return box.width > 0 && box.height >= 24 && text.length > 0 && !busy && !/loading/i.test(text)
    }).length

  const snapshot = () => {
    const nav = document.querySelector('nav[aria-label="Sections"]') ?? document.body
    return `${main().textContent ?? ''}|${nav.textContent ?? ''}|${location.pathname}`
  }

  const state = {
    start: performance.now(),
    tapAt: null,
    first: null,
    content: null,
    rows: null,
    snap: null,
  }
  w.__lat = state

  const origin = () => state.tapAt ?? state.start
  let running = false
  let stopAt = null

  const loop = () => {
    if (state.first === null && state.snap !== null && snapshot() !== state.snap) {
      state.first = Math.round(performance.now() - origin())
    }
    if (state.content === null) {
      const ready =
        !hasSkeleton() && main().querySelector('h1, h2') !== null &&
        (rowCount() > 0 || (main().textContent ?? '').trim().length >= 40)
      if (ready) state.content = Math.round(performance.now() - origin())
    }
    if (state.rows === null && rowCount() > 0) state.rows = Math.round(performance.now() - origin())

    const done = state.first !== null && state.content !== null && state.rows !== null
    const expired = stopAt !== null && performance.now() > stopAt
    if (done || expired) {
      running = false
      return
    }
    requestAnimationFrame(loop)
  }

  const start = (deadlineMs) => {
    if (running) return
    running = true
    stopAt = deadlineMs === null ? null : performance.now() + deadlineMs
    requestAnimationFrame(loop)
  }

  // A MutationObserver as well as the frame loop: a change that happens and
  // settles inside one frame is still a visible change by the time that frame is
  // painted, and the observer does not have to wait for the frame to notice.
  new MutationObserver(() => {
    if (state.first === null && state.snap !== null && snapshot() !== state.snap) {
      state.first = Math.round(performance.now() - origin())
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true })

  w.__latArm = () => {
    state.tapAt = performance.now()
    state.first = null
    state.content = null
    state.rows = null
    state.snap = snapshot()
    start(deadlineMs)
    return state.tapAt
  }

  if (collectFromStart) start(null)
}

/** Read the probe without structured-cloning its functions. */
async function readProbe(page) {
  return page.evaluate(() => {
    const s = window.__lat
    if (!s) return null
    return { tapAt: s.tapAt, first: s.first, content: s.content, rows: s.rows }
  })
}

/** A screen you can read, the way `e2e/v12-taps.mjs` defines readable. */
async function waitForReadable(page, timeout = CONTENT_TIMEOUT_MS) {
  await page.locator('main h1, main h2, header h1, header h2').first().waitFor({ state: 'visible', timeout })
  await page
    .locator('[aria-busy="true"], .animate-pulse')
    .first()
    .waitFor({ state: 'detached', timeout })
    .catch(() => {
      /* no skeleton at all is a pass, not a failure */
    })
}

/** Apply the network profile and the CPU throttle to one page. */
async function throttle(page, profile) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: profile.latencyMs,
    downloadThroughput: (profile.downMbps * 1_000_000) / 8,
    uploadThroughput: (profile.upMbps * 1_000_000) / 8,
  })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE_RATE })
  return cdp
}

/**
 * A logged-in, onboarded, throttled context at the phone viewport.
 *
 * `collectFromStart` decides whether the probe starts polling immediately (a
 * cold-load page) or waits to be armed (a warm page).
 */
async function readyContext(browser, storageState, profile, base, collectFromStart) {
  const context = await browser.newContext({
    baseURL: base,
    storageState: JSON.parse(storageState),
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  await markOnboarded(context)
  await context.addInitScript(probeSource, {
    collectFromStart,
    deadlineMs: PROBE_DEADLINE_MS,
  })
  const page = await context.newPage()
  page.setDefaultTimeout(CONTENT_TIMEOUT_MS)
  const cdp = await throttle(page, profile)
  return { context, page, cdp }
}

/** The control a finger would use to open this screen, or null. */
async function findControl(page, screen) {
  if (screen.tap.kind === 'search') {
    const search = page
      .locator('nav[aria-label="Header actions"] a[aria-label="Search" i], a[aria-label="Search" i]')
      .first()
    return (await search.count()) > 0 ? search : null
  }

  if (screen.tap.kind === 'tab') {
    const bar = page.locator('nav[aria-label="Sections"] a')
    const href = await bar
      .evaluateAll(
        (links, label) =>
          links.find((a) => (a.textContent ?? '').trim().toLowerCase() === label.toLowerCase())
            ?.getAttribute('href') ?? null,
        screen.tap.label,
      )
      .catch(() => null)
    if (!href) return null
    return page.locator(`nav[aria-label="Sections"] a[href="${href}"]`).first()
  }

  // Bar first: the bar is the app's own answer to "how do I get there", and a
  // link buried in a list is a different (and slower) promise.
  const inBar = page.locator(`nav[aria-label="Sections"] a[href$="${screen.tap.endsWith}"]`).first()
  if ((await inBar.count()) > 0) return inBar

  const anywhere = page.locator(`a[href$="${screen.tap.endsWith}"]`).first()
  return (await anywhere.count()) > 0 ? anywhere : null
}

/** Tap the way a finger does: a real pointer gesture at the control's centre. */
async function tap(page, locator) {
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  if (!box) throw new Error('the control has no box — it is not on screen')
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}

/**
 * One cold full-document load, on a context that has never seen this app.
 *
 * A FRESH CONTEXT PER SAMPLE, deliberately. Reusing the warm context and calling
 * `Network.clearBrowserCache` would leave the JS engine, the parsed scripts and
 * the React runtime warm, which is not what a phone picking the app up cold
 * does. A context is cheap; the number is the point.
 */
async function measureColdLoad(browser, storageState, profile, base, screen) {
  const { context, page } = await readyContext(browser, storageState, profile, base, true)
  try {
    await page.goto(screen.path, { waitUntil: 'commit', timeout: NAV_TIMEOUT_MS })
    await page.waitForFunction(() => window.__lat && window.__lat.content !== null, null, {
      timeout: CONTENT_TIMEOUT_MS,
    })
    const probe = await readProbe(page)
    return probe?.content ?? null
  } finally {
    await context.close()
  }
}

/**
 * One tap, from a donor screen, on the warm context.
 *
 * Returns the two tap-relative numbers, or a reason there is no such tap.
 * `hardNavigation` records the case where the tap reloaded the document: the
 * probe is re-installed by the init script and nothing armed it, so the in-page
 * numbers would be measured from the NEW document's zero and read impossibly
 * fast. The wall clock is used instead, and it is flagged.
 */
async function measureTap(page, screen) {
  for (const donor of screen.donors) {
    await page.goto(donor, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
    await waitForReadable(page)

    const control = await findControl(page, screen)
    if (!control) continue

    await page.evaluate(() => window.__latArm())
    const wallStart = Date.now()
    await tap(page, control)
    await page
      .waitForFunction(
        () => window.__lat && (window.__lat.first !== null || window.__lat.content !== null),
        null,
        { timeout: CONTENT_TIMEOUT_MS },
      )
      .catch(() => {})
    const probe = await readProbe(page)
    const wall = Date.now() - wallStart

    if (probe?.tapAt == null) {
      return { first: wall, content: wall, rows: null, hardNavigation: true, donor }
    }
    if (probe.first === null && probe.content === null) {
      return {
        first: null,
        content: null,
        rows: null,
        hardNavigation: false,
        donor,
        reason: `the tap on ${screen.path} produced no measurable change within ${CONTENT_TIMEOUT_MS} ms`,
      }
    }
    return { first: probe.first, content: probe.content, rows: probe.rows, hardNavigation: false, donor }
  }

  return {
    first: null,
    content: null,
    rows: null,
    hardNavigation: false,
    reason: `no control leading to ${screen.path} on any of: ${screen.donors.join(', ')}`,
  }
}

/**
 * The one save this harness times on a screen: a deferred write the app offers an
 * Undo for, so the number costs the TEST event nothing.
 *
 * Only two of the seven screens have one (`Rooms` and `Arrivals`); the other five
 * carry their reason in the catalogue and are reported as not measured rather
 * than left blank.
 */
async function measureSave(page, screen, canSeed) {
  if (!screen.save) return { ms: null, reason: screen.saveReason }
  if (!canSeed) {
    return { ms: null, reason: 'the V12 fixtures were not seeded (--no-seed), so there is nothing to place' }
  }

  await page.goto(screen.path, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
  await waitForReadable(page)

  if (screen.save.kind === 'room-give') return saveRoomGive(page)
  if (screen.save.kind === 'mark-arrived') return saveMarkArrived(page)
  return { ms: null, reason: `unknown save action "${screen.save.kind}"` }
}

/** Give the seeded family the seeded room, time the "done", then undo it. */
async function saveRoomGive(page) {
  const row = page.locator('li', { hasText: FAMILIES.room }).first()
  if ((await row.count()) === 0) {
    return { ms: null, reason: `the seeded family "${FAMILIES.room}" is not on the Rooms board` }
  }
  await tap(page, row.getByRole('button').first())

  const room = page.locator('button', { hasText: new RegExp(`^${ROOM_NUMBER}`) }).first()
  await room.waitFor({ state: 'visible', timeout: CONTENT_TIMEOUT_MS })

  const undo = page.getByRole('button', { name: 'Undo' })
  const started = Date.now()
  await tap(page, room)
  try {
    await undo.waitFor({ state: 'visible', timeout: UNDO_TIMEOUT_MS })
  } catch {
    return { ms: null, reason: 'the room was picked but no Undo appeared, so the write was never confirmed' }
  }
  const ms = Date.now() - started

  // The undo IS the cleanup: without it the family stays placed and the next run
  // has nothing to place, which would report as a failed screen rather than as a
  // missing fixture.
  await undo.click().catch(() => {})
  await undo.waitFor({ state: 'detached', timeout: UNDO_TIMEOUT_MS }).catch(() => {})
  return { ms, reason: null }
}

/** Mark the seeded arrival arrived, time the "done", then undo it. */
async function saveMarkArrived(page) {
  const mark = page.getByRole('button', { name: 'Mark arrived' }).first()
  if ((await mark.count()) === 0) {
    return { ms: null, reason: 'no "Mark arrived" control on the arrivals board' }
  }

  const undo = page.getByRole('button', { name: 'Undo' })
  const started = Date.now()
  await tap(page, mark)
  try {
    await undo.waitFor({ state: 'visible', timeout: UNDO_TIMEOUT_MS })
  } catch {
    return { ms: null, reason: 'the arrival was tapped but no Undo appeared, so the write was never confirmed' }
  }
  const ms = Date.now() - started

  await undo.click().catch(() => {})
  await undo.waitFor({ state: 'detached', timeout: UNDO_TIMEOUT_MS }).catch(() => {})
  return { ms, reason: null }
}

/** One screen's four metrics, on one profile, over `runs` runs. */
async function measureScreen(browser, session, storageState, profile, base, screen, runs, canSeed) {
  const cold = []
  const first = []
  const content = []
  const rows = []
  const save = []
  const reasons = {}
  let hardNavigations = 0

  for (let run = 0; run < runs; run += 1) {
    try {
      const ms = await measureColdLoad(browser, storageState, profile, base, screen)
      if (ms !== null) cold.push(ms)
    } catch (error) {
      reasons.coldFirstLoad = `run ${run + 1}: ${firstLine(error)}`
      break
    }
  }

  for (let run = 0; run < runs; run += 1) {
    let sample
    try {
      sample = await measureTap(session.page, screen)
    } catch (error) {
      sample = { reason: `run ${run + 1}: ${firstLine(error)}` }
    }
    if (sample.reason) {
      reasons.tapToFirstChange = sample.reason
      reasons.tapToContent = sample.reason
      break
    }
    if (sample.hardNavigation) hardNavigations += 1
    if (sample.first !== null) first.push(sample.first)
    if (sample.content !== null) content.push(sample.content)
    if (sample.rows !== null) rows.push(sample.rows)
  }

  if (screen.save) {
    for (let run = 0; run < runs; run += 1) {
      let sample
      try {
        sample = await measureSave(session.page, screen, canSeed)
      } catch (error) {
        sample = { ms: null, reason: `run ${run + 1}: ${firstLine(error)}` }
      }
      if (sample.ms === null) {
        reasons.saveToShownDone = sample.reason
        break
      }
      save.push(sample.ms)
    }
  } else {
    reasons.saveToShownDone = screen.saveReason
  }

  return {
    label: screen.label,
    path: screen.path,
    profile: profile.name,
    metrics: {
      coldFirstLoad: summarize(cold),
      tapToFirstChange: summarize(first),
      tapToContent: summarize(content),
      saveToShownDone: summarize(save),
    },
    reasons,
    /** Reported but not gated: the first real row, and how often the tap reloaded. */
    detail: { tapToRows: summarize(rows), hardNavigations },
  }
}

function firstLine(error) {
  return error instanceof Error ? error.message.split('\n')[0] : String(error)
}

// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2), process.env)
  if (opts.help) {
    process.stdout.write(`${HELP}\n`)
    return 0
  }

  const catalog = selectScreens(screenCatalog('EVENT'), opts.screens)
  const profiles = profilesFor(opts.profile)

  let browser
  try {
    browser = await chromium.launch()
  } catch (error) {
    process.stderr.write(
      `latency: could not launch Chromium — ${firstLine(error)}\n` +
        'latency: this environment cannot run a browser, so no number could be produced.\n' +
        'latency: the harness\'s arithmetic is covered by tests/perf-core.test.ts; the measurement\n' +
        'latency: itself has to run where a browser can start.\n',
    )
    return 2
  }

  let seeded = false
  try {
    const event = await sessionEvent()
    const screens = catalog.map((screen) => ({
      ...screen,
      path: screen.path.replace('/EVENT', `/${event.code}`),
      donors: screen.donors.map((donor) => donor.replace('/EVENT', `/${event.code}`)),
    }))

    process.stdout.write(
      `latency: ${opts.base} · event ${event.code} (${event.name}) · ${
        event.codesShareEvent ? 'team and client codes agree' : 'CODES DISAGREE'
      }\n` +
        `latency: ${screens.length} screens · ${profiles.map((p) => p.name).join(' + ')} · ${opts.runs} runs\n`,
    )

    if (opts.seed) {
      await seed()
      seeded = true
      process.stdout.write('latency: seeded the V12 fixtures (undone at the end)\n')
    } else {
      process.stdout.write('latency: --no-seed — the two "save" metrics will report as not measured\n')
    }

    const storageState = await loginTeam(browserWithBase(browser, opts.base))
    process.stdout.write('latency: signed in as the team session\n')

    const all = []

    for (const profile of profiles) {
      const session = await readyContext(browser, storageState, profile, opts.base, false)
      try {
        // Warm every screen once so a cold server render is never inside a tap.
        for (const screen of screens) {
          await session.page
            .goto(screen.path, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })
            .catch(() => {})
          await waitForReadable(session.page).catch(() => {})
        }
        process.stdout.write(`latency: [${profile.name}] warmed ${screens.length} screens\n`)

        for (const screen of screens) {
          const measured = await measureScreen(
            browser,
            session,
            storageState,
            profile,
            opts.base,
            screen,
            opts.runs,
            seeded,
          )
          all.push(measured)
          const at = (metric) => formatMs(measured.metrics[metric].p50)
          process.stdout.write(
            `latency: [${profile.name}] ${screen.label.padEnd(14)} ` +
              `cold=${at('coldFirstLoad')} tap=${at('tapToFirstChange')} ` +
              `content=${at('tapToContent')} save=${at('saveToShownDone')}\n`,
          )
          for (const [metric, reason] of Object.entries(measured.reasons)) {
            process.stdout.write(`latency:   ${metric}: not measured — ${reason}\n`)
          }
        }
      } finally {
        await session.context.close()
      }
    }

    const rows = gradeRun(all)
    const meta = {
      generatedAt: new Date().toISOString(),
      base: opts.base,
      event: event.code,
      runs: opts.runs,
      profiles: profiles.map((p) => p.name),
    }

    const outPath = resolve(opts.out)
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(
      outPath,
      `${JSON.stringify(
        {
          meta: {
            ...meta,
            viewport: VIEWPORT,
            cpuThrottle: CPU_THROTTLE_RATE,
            screens: screens.map((s) => s.label),
          },
          screens: all,
          rows,
        },
        null,
        2,
      )}\n`,
    )

    const mdPath = resolve(opts.md)
    mkdirSync(dirname(mdPath), { recursive: true })
    writeFileSync(mdPath, renderMarkdown({ rows, meta }))

    process.stdout.write(`latency: wrote ${opts.out} and ${opts.md}\n`)

    const failed = failures(rows)
    const notMeasured = rows.filter((row) => row.verdict === 'not-measured')
    process.stdout.write(
      `latency: ${rows.length} rows · ${failed.length} over a gated budget · ${notMeasured.length} not measured\n`,
    )
    for (const row of failed) {
      process.stdout.write(
        `latency: FAIL ${row.screen} (${row.profile}) ${row.metric}: ` +
          `p50 ${formatMs(row.p50)} against ${formatMs(row.budget)}\n`,
      )
    }

    // Exit 1 on a missed GATE only. A cold-load warning does not fail the
    // command: SPEC-PERF calls that budget informational, and a command that goes
    // red on an informational number stops being run at all.
    return failed.length > 0 ? 1 : 0
  } finally {
    await browser.close().catch(() => {})
    if (seeded) await unseed().catch(() => {})
  }
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    process.stderr.write(`latency: FAILED — ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
    process.exitCode = 1
  })
