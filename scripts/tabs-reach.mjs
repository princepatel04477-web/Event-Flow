/**
 * Does every destination the new UI can reach actually resolve?
 *
 * WHY THIS EXISTS. Under `NEXT_PUBLIC_UI=v2` the proxy rewrites an event-scoped
 * URL onto `(app)/v2/[eventCode]/...`, and there is NO rewrite fallback: a path
 * with no file under the new group renders the 404 screen rather than the legacy
 * screen. Verified on a production build. So any tab, card or row whose `href`
 * was not carried across is a dead control on a phone at a venue, and the bar is
 * the only navigation most of these users have.
 *
 * `tests/v2-route-parity.test.ts` proves the same thing against the filesystem.
 * This script is the live half: it drives a real browser, signs in for real,
 * reads the hrefs the rendered pages actually emit (not the ones we think they
 * emit) and reports where each one lands. The two are deliberately independent —
 * the test can be right about the disk and wrong about the app.
 *
 * WHY NOT THE PLAYWRIGHT TEST RUNNER. It hangs in this repo before evaluating
 * any spec, and the pre-existing `phone` suite hangs identically, so the runner
 * is the blocked component. The BROWSER works. Same approach as
 * `scripts/feel-baseline.mjs`.
 *
 * THE STAFF PICK IS THE WHOLE TRICK, AND IT IS WHY THIS SCRIPT HAS TWO MODES.
 * The bar's contents are decided by `bottomTabsFor(eventCode, access, department)`:
 *   - a client gets no bar;
 *   - a runner whose department is a single screen (Hampers, Setup) gets no bar;
 *   - an event lead gets the five sections — Home, Guests, Calls, Travel, Rooms;
 *   - a runner in a multi-screen department gets that section's children.
 * `department` comes from the session's staff identity, and a code-auth session
 * that has NOT picked a name has none — so it gets a single Home tab and this
 * script would "prove" one link. That is a real state (a fresh login) but it is
 * not the state the bar was built for, and checking it alone would report a
 * green that means nothing.
 *
 * So: default = sign in and STOP at /pick-staff (the raw post-login state, no
 * department, one tab). `--pick <name>` = also tap that staff member, which is
 * what an event lead does, and then the five-tab bar is on screen and every
 * destination in it is exercised. Run BOTH; they answer different questions.
 *
 * NOTE ON THE EVENT CODE. The brief for this script said to read a
 * `nuvent_event_code` COOKIE. No such cookie exists to read — that name is a
 * `sessionStorage` key owned by the native session keeper
 * (`src/lib/native/session-keeper.ts`), written on the phone, not by login. The
 * event code is read from the "Skip for now" link on `/pick-staff`, which the
 * server renders as `/{eventCode}` from the session claims. That is the same
 * value from the same place the cookie would have held, read where it actually
 * is. `E2E_EVENT_CODE` still wins if it is ever defined.
 *
 * USAGE
 *   node scripts/tabs-reach.mjs
 *   node scripts/tabs-reach.mjs --pick "Test Caller A"
 *   node scripts/tabs-reach.mjs --base http://localhost:3000
 *
 * Exit code is non-zero if ANY destination renders the 404 screen. The table
 * prints either way, so a failing run is still evidence.
 */
import { readFileSync } from 'node:fs'

import { chromium } from 'playwright'

const argv = process.argv.slice(2)
function arg(name, fallback = null) {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

const BASE = arg('--base', process.env.E2E_BASE_URL ?? 'http://localhost:3000')
const PICK = arg('--pick', null)

/** The copy both 404 boundaries render. Kept in step with src/app/not-found.tsx
 *  ("We could not find that page") and (staff)/[eventCode]/not-found.tsx
 *  ("That page is not here") — a missing route can surface as either, because a
 *  v2 route may be a shim of a legacy page whose own not-found boundary fires. */
const NOT_FOUND_TITLES = ['We could not find that page', 'That page is not here']

/**
 * The server-error boundary's title, from (staff)/[eventCode]/error.tsx.
 *
 * A THIRD state, and it has to be told apart from the other two. It is also an
 * `EmptyState` — same dashed rule, same centred layout as the 404 — so a
 * detector that keys on that shape cannot distinguish "this route does not
 * exist" from "this route exists and threw". Those need different fixes (a shim
 * vs a bug in the screen), and reporting the second as the first would send the
 * next session looking for a missing file that is already there.
 */
const ERROR_TITLE = 'This screen did not load'

function parseEnv(path) {
  const out = {}
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const eq = t.indexOf('=')
      if (eq <= 0) continue
      out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    }
  } catch {
    // A missing env file is reported by the login step failing loudly, which is
    // a better error than a stack trace from here.
  }
  return out
}

const env = {
  ...parseEnv('C:\\dev\\EventFlow\\.env.local'),
  ...parseEnv('C:\\dev\\EventFlow\\.env.test'),
}

const mark = (m) => console.log(m)

/**
 * Sign in through the real UI and stop at /pick-staff.
 *
 * Deliberately does NOT use `e2e/helpers/auth.ts`'s `loginTeamAs`: that picks a
 * staff member, and the whole point of the default run is to observe the bar
 * before a department exists.
 */
async function signIn(browser) {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 } })
  const page = await context.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Access code').fill(env.E2E_TEAM_CODE)
  await page.getByRole('button', { name: /enter event|checking/i }).click()
  await page.waitForURL(/\/pick-staff/, { timeout: 45_000 })
  return { context, page }
}

/**
 * The event code this session belongs to.
 *
 * NOT `E2E_EVENT_ID`, which names a different event (E12345) from the one
 * `E2E_TEAM_CODE` signs into (SAMPLE2026) — and NOT `E2E_EVENT_CODE`, which is
 * not defined in this repo's .env.test at all. Read off the rendered skip link,
 * so it is whatever the app itself believes.
 */
async function resolveEventCode(page) {
  const override = env.E2E_EVENT_CODE ?? process.env.E2E_EVENT_CODE
  if (override) return override
  const skip = page.locator('a[href^="/"]', { hasText: /skip for now/i }).first()
  const href = await skip.getAttribute('href', { timeout: 15_000 })
  const code = (href ?? '').split('/').filter(Boolean)[0]
  if (!code) throw new Error(`could not read an event code from the skip link (href=${href})`)
  return code
}

/** Tap a staff member and land inside the event. */
async function pickStaff(page, name) {
  await page.getByRole('button', { name, exact: false }).first().click()
  await page.waitForURL((u) => !u.pathname.startsWith('/pick-staff') && !u.pathname.startsWith('/login'), {
    timeout: 45_000,
  })
}

/**
 * Classify the document the route landed on: 'ok' | '404' | 'error'.
 *
 * THREE SIGNALS, because no single one is reliable and the first version of this
 * script was fooled by trusting only the third. All three were observed on a
 * real session:
 *
 *   1. A page that threw server-side still answers HTTP 200 and still carries
 *      its OWN <title> ("RSVP Campaigns · EventFlow"), so neither the status nor
 *      the title gives it away.
 *   2. The React error boundary is NOT guaranteed to be on screen. It renders
 *      "This screen did not load" on some hydration paths; on others the failed
 *      page just leaves a near-empty <main> with no bar at all. So looking for
 *      that heading alone reports "ok" for a screen that visibly failed — a
 *      false pass, and the reason this function was rewritten.
 *   3. A server-render failure always logs to the browser console, which is the
 *      most reliable of the three and is why `consoleErrors` is threaded in.
 *
 * `opts.expectsBar` says whether this destination should render the bottom bar,
 * and it is NOT simply "true for everything". Every EVENT-SCOPED screen under
 * the v2 shell does, but a handful of real destinations sit outside the shell
 * and have no bar by design — `/pick-staff` is one, and the home links to it for
 * a team session that has not picked a name yet (StaffWelcomeBanner). Demanding
 * a bar there would report a working screen as broken, which is the same class
 * of error as missing one that is actually broken.
 */
async function classify(page, { consoleErrors = [], expectsBar = true } = {}) {
  const dom = await page.evaluate(
    ({ notFound, error }) => {
      const titles = Array.from(document.querySelectorAll('h2')).map((h) => (h.textContent ?? '').trim())
      return {
        missing: titles.some((t) => notFound.includes(t)),
        errorBoundary: titles.some((t) => t === error),
        hasBar: !!document.querySelector('nav[aria-label="Sections"]'),
        mainLen: (document.querySelector('main')?.textContent ?? '').replace(/\s+/g, ' ').trim().length,
      }
    },
    { notFound: NOT_FOUND_TITLES, error: ERROR_TITLE },
  )

  if (dom.missing) return '404'
  // The boundary's own copy, or the RSC failure it is standing in for. Checked
  // for every destination, shell or not — a server render threw either way.
  if (dom.errorBoundary || consoleErrors.some((t) => /Server Components render|App failed/i.test(t))) {
    return 'error'
  }
  if (!expectsBar) return 'ok'
  if (!dom.hasBar) return 'error'
  // A screen that should have a bar rendered almost nothing at all. The loosest
  // of the three, and last, so it only catches what the others missed.
  if (dom.mainLen < 80) return 'error'
  return 'ok'
}

/**
 * Every href on the current page that this session can actually reach, in the
 * order the DOM presents them: the bar's tabs first, then the home screen's job
 * cards and Today row, then anything else inside `main`.
 */
async function collectHrefs(page) {
  return page.evaluate(() => {
    const rows = []
    const add = (kind, a) => {
      const href = a.getAttribute('href')
      if (!href || href.startsWith('#') || href.startsWith('tel:') || href.startsWith('mailto:')) return
      rows.push({ kind, href, label: (a.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 28) })
    }

    const nav = document.querySelector('nav[aria-label="Sections"]')
    if (nav) for (const a of nav.querySelectorAll('a[href]')) add('tab', a)

    // The job cards and Today row are the home screen's own links; they are the
    // other half of "the new UI can navigate somewhere".
    for (const a of document.querySelectorAll('main a[href]')) {
      const kind = a.querySelector('.figure') ? 'figure' : 'main'
      add(kind, a)
    }
    return rows
  })
}

/** De-duplicate by href, keeping the first (most specific) kind we saw. */
function dedupe(rows) {
  const seen = new Map()
  for (const r of rows) if (!seen.has(r.href)) seen.set(r.href, r)
  return [...seen.values()]
}

/**
 * Navigate to the first candidate that genuinely renders the bar, and return it.
 *
 * WHY NOT JUST USE THE HOME. `page.goto('/{event}')` is not a reliable place to
 * read the bar from, for two reasons that both show up on a real session:
 *
 *   - The v2 home redirects an event_team member with a department straight to
 *     `departmentHomePath(...)` — `/rsvp/campaigns` for a lead. So the home URL
 *     does not necessarily land on the home screen.
 *   - If that redirect lands on a screen that throws, this script would collect
 *     the failed page's links (one `/` link) and report a confident green over a
 *     single destination. That is a false pass, and it is exactly what the first
 *     run of this script did.
 *
 * So the home is navigated to and *reported* — its own state is worth knowing —
 * but the bar is read from the first destination that genuinely renders one.
 * Returns null when nothing does, which `run` treats as a hard error.
 */
async function findBarPage(page, candidates) {
  for (const path of candidates) {
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle').catch(() => {})
    const links = await page.evaluate(() => {
      const bar = document.querySelector('nav[aria-label="Sections"]')
      return bar ? bar.querySelectorAll('a[href]').length : 0
    })
    if (links > 0) return path
  }
  return null
}

async function run() {
  if (!env.E2E_TEAM_CODE) throw new Error('E2E_TEAM_CODE is not set — cannot sign in')

  const browser = await chromium.launch()
  mark(`chromium ${browser.version()} launched`)
  mark(`base   ${BASE}`)
  mark(`mode   ${PICK ? `pick staff "${PICK}" (full bar)` : 'stop at /pick-staff (no department, 1 tab)'}`)

  const { context, page } = await signIn(browser)
  const code = await resolveEventCode(page)
  mark(`event  ${code}  (from the rendered skip link, not E2E_EVENT_ID)`)
  mark(`signed in; stopped at ${new URL(page.url()).pathname}`)

  if (PICK) {
    await pickStaff(page, PICK)
    mark(`picked "${PICK}"; landed on ${new URL(page.url()).pathname}`)
  }

  // Every server-render failure surfaces on the browser console, so collect
  // them per navigation — the DOM alone does not reliably show the failure.
  // Registered once here; the loop below just resets the buffer.
  let consoleErrors = []
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text())
  })
  page.on('pageerror', (e) => consoleErrors.push(e.message))

  await page.goto(`${BASE}/${code}`, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => {})
  const homeFinal = new URL(page.url()).pathname
  const homeVerdict = await classify(page, {
    consoleErrors,
    // The home redirects a lead to `/{event}/rsvp/campaigns`, so the thing to
    // judge is where it actually landed, not the URL that was asked for.
    expectsBar: homeFinal === `/${code}` || homeFinal.startsWith(`/${code}/`),
  })
  mark(`home   /${code} -> ${homeFinal}  [${homeVerdict}]`)

  // Read the bar from a page that actually renders one — see findBarPage for
  // why the home cannot be trusted for this.
  const barPath = await findBarPage(page, [
    `/${code}`,
    `/${code}/guests/list`,
    `/${code}/rsvp/queue`,
    `/${code}/hospitality/rooms`,
    `/${code}/logistics/arrivals`,
  ])
  if (!barPath) throw new Error(`no screen under /${code} rendered the bar — nothing to check`)
  mark(`bar read from ${barPath}`)

  const rows = dedupe(await collectHrefs(page))
  mark(`collected ${rows.length} distinct destination(s) from ${barPath}`)

  // The home screen's own job cards and Today row, collected separately because
  // `findBarPage` may have walked past the home (a lead is redirected off it).
  // A redirect on the home means these are whatever the destination renders —
  // still real hrefs from a real render, just not the home's.
  await page.goto(`${BASE}/${code}`, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => {})
  const homeRows = await collectHrefs(page)
  for (const r of homeRows) {
    if (!rows.some((x) => x.href === r.href)) rows.push(r)
  }
  mark(`+ ${homeRows.length} href(s) seen on the home render`)

  const results = []
  for (const r of rows) {
    const url = r.href.startsWith('http') ? r.href : `${BASE}${r.href}`
    let finalUrl = url
    let status = 'ok'
    let detail = ''
    try {
      consoleErrors = []
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      await page.waitForLoadState('networkidle').catch(() => {})
      finalUrl = new URL(page.url()).pathname
      // The bar belongs to the event shell, so it is only expected on a screen
      // that actually resolved inside it. `/pick-staff` is a real destination
      // outside the shell and legitimately has none.
      const expectsBar = finalUrl === `/${code}` || finalUrl.startsWith(`/${code}/`)
      const verdict = await classify(page, { consoleErrors, expectsBar })
      if (verdict === '404') {
        status = '404'
        detail = 'no route here'
      } else if (verdict === 'error') {
        status = 'ERR-UI'
        detail = 'route exists, screen threw'
      } else if (resp && resp.status() >= 400) {
        status = `http ${resp.status()}`
        detail = 'non-2xx'
      }
    } catch (e) {
      status = 'ERR'
      detail = e instanceof Error ? e.message.split('\n')[0].slice(0, 60) : String(e)
    }
    results.push({ ...r, finalUrl, status, detail })
  }

  // ---- the table -----------------------------------------------------------
  const w = Math.max(6, ...results.map((r) => r.href.length))
  mark('')
  mark(`${'KIND'.padEnd(7)} ${'HREF'.padEnd(w)}  ${'FINAL'.padEnd(Math.min(28, w))}  RESULT`)
  mark(`${'-'.repeat(7)} ${'-'.repeat(w)}  ${'-'.repeat(Math.min(28, w))}  ${'-'.repeat(6)}`)
  for (const r of results) {
    const ok = r.status === 'ok'
    mark(
      `${r.kind.padEnd(7)} ${r.href.padEnd(w)}  ${r.finalUrl.padEnd(Math.min(28, w))}  ${
        ok ? 'ok' : `${r.status}${r.detail ? ` (${r.detail})` : ''}`
      }`,
    )
  }

  const tabs = results.filter((r) => r.kind === 'tab')
  const notFound = results.filter((r) => r.status === '404')
  const uiErrors = results.filter((r) => r.status === 'ERR-UI')
  mark('')
  mark(`home  /${code} -> ${homeFinal}  [${homeVerdict}]`)
  mark(`tabs found: ${tabs.length}${tabs.length ? ` -> ${tabs.map((t) => t.href).join(', ')}` : ''}`)
  mark(`destinations checked: ${results.length}`)
  mark(`  404 (no route)          : ${notFound.length}${notFound.length ? ` -> ${notFound.map((r) => r.href).join(', ')}` : ''}`)
  mark(`  screen threw (has route): ${uiErrors.length}${uiErrors.length ? ` -> ${uiErrors.map((r) => r.href).join(', ')}` : ''}`)

  await context.close()
  await browser.close()

  const clean = notFound.length === 0 && uiErrors.length === 0
  mark(clean ? '=== PASS ===' : '=== FAIL ===')
  process.exit(clean ? 0 : 1)
}

run().catch((e) => {
  mark(`FAILED: ${e instanceof Error ? e.stack ?? e.message : String(e)}`)
  process.exit(1)
})
