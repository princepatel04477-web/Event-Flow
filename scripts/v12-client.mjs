/**
 * V12 client probe — what does a CLIENT session actually see?
 *
 * Two of the nine tap budgets in `e2e/obvious.spec.ts` are client-session tasks
 * ("find my own room number", "see who is arriving today"). `scripts/v12-reach.mjs`
 * shows the client code lands on `/{event}/guests` and that every other
 * event-scoped URL bounces back there, and AMENDMENTS §3 records that several
 * v2 paths are shims. A budget measured on a screen a client cannot open is a
 * number about nothing, so this prints the client's real reachable surface.
 * READ-ONLY.
 *
 *   node scripts/v12-client.mjs
 */
import { readFileSync } from 'node:fs'

import { chromium } from 'playwright'

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3000'

function parseEnv(path) {
  const out = {}
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
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
    /* reported by the login failing */
  }
  return out
}

const env = { ...parseEnv('.env.local'), ...parseEnv('.env.test') }

const browser = await chromium.launch()
const context = await browser.newContext({ baseURL: BASE, viewport: { width: 360, height: 800 } })
const page = await context.newPage()

// Every navigation the client session makes, in order. The client's guest list
// kept navigating underneath the first version of this probe, which destroyed
// the execution context mid-read; this records where it went.
const hops = []
page.on('framenavigated', (frame) => {
  if (frame === page.mainFrame()) hops.push(`${Date.now()} ${frame.url()}`)
})
page.on('request', (r) => {
  if (r.isNavigationRequest()) hops.push(`  req ${r.method()} ${r.url()}`)
})

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.getByLabel('Access code').fill(env.E2E_CLIENT_CODE)
await page.getByRole('button', { name: /enter event|checking/i }).click()
await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 45_000 })
await page.waitForLoadState('networkidle').catch(() => {})
console.log(`landed ${new URL(page.url()).pathname}`)

console.log('\nnavigation trace from the landing:')
await page.goto(`${BASE}/SAMPLE2026/guests`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(10_000)
for (const hop of hops.slice(-20)) console.log(`  ${hop}`)
console.log(`  final: ${new URL(page.url()).pathname}`)

/**
 * Read the DOM, retrying if the page navigated underneath us.
 *
 * The first version crashed here: the client's guest list keeps navigating for
 * a second or two after `domcontentloaded` (it is a legacy screen rendered
 * inside the new shell), and `page.evaluate` throws "Execution context was
 * destroyed" when that happens. Retrying is the honest fix — the screen is
 * reachable, it is just slower to settle than the shell around it.
 */
const describe = async (label) => {
  let info = null
  for (let attempt = 0; attempt < 4 && info === null; attempt += 1) {
    try {
      info = await page.evaluate(() => ({
        h1: Array.from(document.querySelectorAll('main h1, header h1, main h2')).map((h) =>
          (h.textContent ?? '').trim(),
        ),
        tabs: !!document.querySelector('nav[aria-label="Sections"]'),
        header: Array.from(document.querySelectorAll('nav[aria-label="Header actions"] a')).map((a) => ({
          label: a.getAttribute('aria-label'),
          href: a.getAttribute('href'),
        })),
        controls: Array.from(document.querySelectorAll('main button, main a[href], main input')).map(
          (el) => ({
            tag: el.tagName.toLowerCase(),
            text: (el.textContent ?? el.getAttribute('placeholder') ?? '')
              .trim()
              .replace(/\s+/g, ' ')
              .slice(0, 46),
            href: el.getAttribute('href'),
          }),
        ),
        rowSample: Array.from(document.querySelectorAll('main li')).slice(0, 4).map((li) =>
          (li.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 90),
        ),
        bodySample: (document.body.innerText ?? '').replace(/\s+/g, ' ').slice(0, 260),
      }))
    } catch {
      await page.waitForTimeout(1_500)
    }
  }
  console.log(`\n[${label}] ${new URL(page.url()).pathname}`)
  if (!info) {
    console.log('  (page kept navigating — no stable read)')
    return
  }
  console.log(`  h1/h2   ${JSON.stringify(info.h1.slice(0, 5))}`)
  console.log(`  bar     ${info.tabs}`)
  console.log(`  header  ${JSON.stringify(info.header)}`)
  console.log(`  controls ${JSON.stringify(info.controls.slice(0, 12))}`)
  console.log(`  rows    ${JSON.stringify(info.rowSample)}`)
  console.log(`  text    ${info.bodySample}`)
}

await describe('client landing')

for (const path of ['guests', 'guests/list', 'find']) {
  await page.goto(`${BASE}/SAMPLE2026/${path}`, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle').catch(() => {})
  await describe(path)
}

// The client guest list settles after the shell paints, so give it a moment and
// read it once more — the first pass above shows the loading state.
await page.goto(`${BASE}/SAMPLE2026/guests`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6_000)
await describe('guests (settled)')

await context.close()
await browser.close()
