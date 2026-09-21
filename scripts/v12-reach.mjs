/**
 * V12 reach probe — which event can this session actually see?
 *
 * WHY THIS EXISTS. `e2e/helpers/env.ts` names `E2E_EVENT_ID` (E12345) as "the
 * test event", and `.env.test`'s `E2E_TEAM_CODE` / `E2E_CLIENT_CODE` are the
 * only way in. FEEL-BASELINE.md already records that those two name different
 * events, and a tap budget measured on a screen the session cannot open is a
 * number about nothing. So this signs in for real and reports what each event
 * URL renders.
 *
 * It is READ-ONLY: it signs in, navigates, and prints. It writes nothing.
 *
 *   node scripts/v12-reach.mjs
 *   node scripts/v12-reach.mjs --base http://localhost:3000
 */
import { readFileSync } from 'node:fs'

import { chromium } from 'playwright'

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

const BASE = arg('--base', process.env.E2E_BASE_URL ?? 'http://localhost:3000')

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
    /* reported by the login step failing */
  }
  return out
}

const env = { ...parseEnv('.env.local'), ...parseEnv('.env.test') }

async function signIn(browser, code) {
  const context = await browser.newContext({ viewport: { width: 360, height: 800 } })
  const page = await context.newPage()
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Access code').fill(code)
  await page.getByRole('button', { name: /enter event|checking/i }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 45_000 })
  return { context, page }
}

const browser = await chromium.launch()
console.log(`chromium ${browser.version()}  base ${BASE}`)

for (const [label, code, pick] of [
  ['TEAM', env.E2E_TEAM_CODE, env.E2E_TEAM_STAFF],
  ['CLIENT', env.E2E_CLIENT_CODE, null],
]) {
  const { context, page } = await signIn(browser, code)
  const landed = new URL(page.url()).pathname
  console.log(`\n${label}  ${code}  landed ${landed}`)

  if (pick) {
    const btn = page.getByRole('button', { name: pick, exact: false }).first()
    const visible = await btn
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false)
    console.log(`  picker: ${visible ? 'staff picker shown' : 'no staff picker (client session)'}`)
    if (visible) {
      await btn.click()
      await page.waitForURL((u) => !u.pathname.startsWith('/pick-staff'), { timeout: 45_000 })
      console.log(`  picked "${pick}" -> ${new URL(page.url()).pathname}`)
    }
  }

  for (const eventCode of ['SAMPLE2026', 'E12345']) {
    for (const path of ['', '/rsvp/queue', '/guests/list', '/hospitality/rooms', '/logistics/arrivals', '/find']) {
      const url = `${BASE}/${eventCode}${path}`
      let status = '?'
      let finalPath = ''
      try {
        const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
        await page.waitForLoadState('networkidle').catch(() => {})
        status = String(resp?.status() ?? '?')
        finalPath = new URL(page.url()).pathname
        const text = await page
          .locator('body')
          .innerText()
          .catch(() => '')
        const flag = /could not find|not here|did not load|you do not have|not allowed|sign in/i.test(text)
          ? ' ← bounced/empty'
          : ''
        console.log(`  ${status}  /${eventCode}${path} -> ${finalPath}${flag}`)
      } catch (e) {
        console.log(`  ERR  /${eventCode}${path} ${e instanceof Error ? e.message.split('\n')[0] : e}`)
      }
    }
  }

  await context.close()
}

await browser.close()
