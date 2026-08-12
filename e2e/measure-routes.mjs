// Server-side route timing, measured on the HTML document only.
//
// WHY NOT THE PLAYWRIGHT HARNESS. e2e/perf.spec.ts measures wall-clock to the
// browser `load` event on an emulated Pixel 5. That is ~600ms of JS parse and
// hydration on top of the server render, so it swamped the thing being changed:
// removing a 175ms round trip moved the number by less than the run-to-run
// noise. TTFB is no better — this app streams (11 loading.tsx files), so the
// first byte is the shell, not the data.
//
// The document fetch is the honest measure: the response stream does not end
// until the server has finished every await behind it, and there is no browser
// work in the number at all.
//
//   node e2e/measure-routes.mjs before
//   node e2e/measure-routes.mjs after
//
// Writes e2e/routes-<label>.json and prints a table.

import { chromium } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'

const LABEL = process.argv[2] ?? 'run'
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3100'
const SAMPLES = 5

function env() {
  const out = {}
  for (const line of readFileSync('.env.test', 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#') || !t.includes('=')) continue
    const i = t.indexOf('=')
    let v = t.slice(i + 1).trim()
    if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.endsWith(v[0])) v = v.slice(1, -1)
    out[t.slice(0, i).trim()] = v
  }
  return out
}

const E = env()

/** Log in through the real UI and return { cookie, code }. */
async function session(kind) {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ baseURL: BASE })
  const page = await ctx.newPage()

  if (kind === 'admin') {
    await page.goto('/admin/login')
    await page.getByLabel('Email').fill(E.E2E_USER_A_EMAIL)
    await page.getByLabel('Password').fill(E.E2E_USER_A_PASSWORD)
    await page.getByRole('button', { name: /sign in|enter event/i }).click()
    await page.waitForURL((u) => !u.pathname.startsWith('/admin/login'), { timeout: 30000 })
  } else {
    await page.goto('/login')
    await page.getByLabel('Access code').fill(E.E2E_TEAM_CODE)
    await page.getByRole('button', { name: /enter event|checking/i }).click()
    await page.waitForURL(/\/pick-staff/, { timeout: 30000 })
    await page.getByRole('button', { name: E.E2E_TEAM_STAFF, exact: false }).first().click()
    await page.waitForURL((u) => !u.pathname.startsWith('/pick-staff'), { timeout: 30000 })
  }

  const cookies = await ctx.cookies()
  const cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
  let code = new URL(page.url()).pathname.split('/').filter(Boolean)[0]
  if (!code || code === 'admin') code = null
  await browser.close()
  return { cookie, code }
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

/** Time the document fetch, reading the body to completion (streaming). */
async function timeDoc(url, cookie) {
  const t0 = performance.now()
  const res = await fetch(url, { headers: { cookie, accept: 'text/html' }, redirect: 'manual' })
  const body = await res.text()
  return { ms: Math.round(performance.now() - t0), status: res.status, bytes: body.length }
}

const ROUTES = ['', '/guests', '/queue', '/rooms', '/deliveries', '/arrivals', '/fleet', '/logistics']

const results = []

for (const kind of ['admin', 'team']) {
  const { cookie, code } = await session(kind)
  // The admin lands on /admin/events; fall back to the team's event so both
  // sessions are measured on the SAME routes.
  const eventCode = code ?? (await session('team')).code
  console.log(`\n${kind} session -> /${eventCode}`)

  for (const route of ROUTES) {
    const url = `${BASE}/${eventCode}${route}`

    // Warm the process once so first-call connection setup is not counted.
    await timeDoc(`${url}?cb=warm`, cookie)

    // Cold: cache-busted each time, so the 30s TTL cache cannot serve it.
    const cold = []
    for (let i = 0; i < SAMPLES; i += 1) {
      const r = await timeDoc(`${url}?cb=${Date.now()}-${i}`, cookie)
      if (r.status !== 200) {
        console.log(`  ${route || '/'} -> status ${r.status}, skipping`)
        cold.length = 0
        break
      }
      cold.push(r.ms)
    }
    if (cold.length === 0) continue

    // Warm: same URL, so TTL-cached reads are served from memory.
    const warm = []
    for (let i = 0; i < SAMPLES; i += 1) {
      warm.push((await timeDoc(url, cookie)).ms)
    }

    const row = { session: kind, route: route || '/', cold: median(cold), warm: median(warm) }
    results.push(row)
    console.log(`  ${row.route.padEnd(12)} cold=${row.cold}ms warm=${row.warm}ms`)
  }
}

writeFileSync(`e2e/routes-${LABEL}.json`, JSON.stringify(results, null, 2))
console.log(`\nwrote e2e/routes-${LABEL}.json`)
