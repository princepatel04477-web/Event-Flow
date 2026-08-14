#!/usr/bin/env node
/**
 * T3 — PRE-EVENT SMOKE. Run this before the event, and again at 8am on the day.
 *
 *     npm run smoke
 *
 * No arguments. Runs against the DEPLOYED build with REAL credentials. Not
 * localhost, not mocks, not a seeded scratch database.
 *
 * WHY THIS SUITE EXISTS
 * The 123 unit tests all pass while the app fails on a handset, because they
 * test whether functions return correct values, not whether the deployed
 * system works. Every failure this week was the same shape — a gap between
 * what the code does and what the deployed system does:
 *
 *   - the caller lock passed every test and died on real auth
 *   - extract-rsvp was "deployed" and had no trigger and no call site
 *   - the recorder was "built" and was a placeholder card
 *
 * None of those were catchable by a test that never left the laptop. So step 1
 * of this suite is deployment truth: is the code serving production the code I
 * think it is, and does every function I depend on actually answer.
 *
 * READING THE OUTPUT
 * One line per check, PASS/FAIL/SKIP, then a summary. A FAIL names the exact
 * step. No interpretation required — if a line says FAIL, that thing is broken
 * right now, in production.
 *
 * BLOCKING vs NON-BLOCKING: a BLOCK line means do not run the event on this
 * build. A FAIL is a real defect that may still be worked around.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

function parseEnvFile(path) {
  const out = {}
  if (!existsSync(path)) return out
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
  }
  return out
}

const env = {
  ...parseEnvFile(join(process.cwd(), '.env.local')),
  ...parseEnvFile(join(process.cwd(), '.env.test')),
  ...process.env,
}

const BASE_URL = (env.SMOKE_BASE_URL ?? '').replace(/\/$/, '')
const SUPABASE_URL = (env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY ?? ''
// No default. A fallback event code is how a pre-event gate ends up cheerfully
// green against an event nobody is running: SHARMA26 was hardcoded here, and
// the suite kept certifying it long after it stopped being the live event.
// Refusing to run is the only honest behaviour when the target is unstated.
const EVENT_CODE = env.SMOKE_EVENT_CODE ?? ''

const HTTP_TIMEOUT_MS = 25_000

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

const results = []
const t0 = Date.now()

function record(id, label, status, detail = '') {
  results.push({ id, label, status, detail })
  const tag =
    status === 'PASS' ? '  PASS' :
    status === 'FAIL' ? '  FAIL' :
    status === 'BLOCK' ? ' BLOCK' :
    status === 'WARN' ? '  WARN' : '  SKIP'
  console.log(`${tag}  ${id.padEnd(8)} ${label}${detail ? ` — ${detail}` : ''}`)
}

/** Run a check; an unexpected throw is a FAIL, never a crash that hides the rest. */
async function check(id, label, fn, { blocking = false } = {}) {
  try {
    const detail = await fn()
    record(id, label, 'PASS', detail ?? '')
    return true
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    record(id, label, blocking ? 'BLOCK' : 'FAIL', msg)
    return false
  }
}

function fail(message) {
  throw new Error(message)
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// Supabase (service role — SETUP AND INSPECTION ONLY)
//
// This suite asks "does production hold the data the event needs", which is a
// question about rows existing, not about who may read them. Service role is
// the right tool for that and the wrong tool for isolation testing — see T1,
// where using it would make every assertion a false green.
// ---------------------------------------------------------------------------

async function sb(path, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetchWithTimeout(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body,
  })
  return res
}

async function countRows(table, eventId) {
  const res = await sb(
    `/rest/v1/${table}?select=id&event_id=eq.${eventId}&limit=1`,
    { headers: { Prefer: 'count=exact' } },
  )
  if (!res.ok) fail(`${table}: HTTP ${res.status} ${(await res.text()).slice(0, 120)}`)
  const range = res.headers.get('content-range') ?? ''
  const total = Number(range.split('/')[1])
  return Number.isFinite(total) ? total : 0
}

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

function preflight() {
  const missing = []
  if (!BASE_URL) missing.push('SMOKE_BASE_URL')
  if (!EVENT_CODE) missing.push('SMOKE_EVENT_CODE')
  if (!SUPABASE_URL) missing.push('SUPABASE_URL')
  if (!ANON_KEY) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  if (!SERVICE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY')
  // The spec falls back to E2E_TEAM_CODE when SMOKE_TEAM_CODE is unset, and
  // that fallback belongs to whichever event the E2E fixtures use. When the
  // two disagree, the whole critical path signs into event A and then browses
  // event B: every walk fails, none of the failures are real, and the suite
  // has never once exercised the event it prints at the top of its own report.
  // That happened — SMOKE_TEAM_CODE was empty while SMOKE_EVENT_CODE was set —
  // and it also tripped a React #310 on the cross-event notFound() path, which
  // read as a product crash for hours. Refuse rather than infer.
  if (!env.SMOKE_TEAM_CODE) missing.push(`SMOKE_TEAM_CODE (a TEAM code for ${EVENT_CODE || 'SMOKE_EVENT_CODE'})`)
  if (missing.length) {
    console.error('\nSmoke cannot start. Missing from .env.test / .env.local:\n  ' + missing.join('\n  '))
    console.error(
      '\nSMOKE_BASE_URL must be the STABLE production alias (e.g. https://nuvent-five.vercel.app),\n' +
        'never a per-deployment URL — those keep answering 200 forever while serving old code.\n' +
        'SMOKE_TEAM_CODE and SMOKE_CLIENT_CODE must belong to SMOKE_EVENT_CODE. A code from a\n' +
        'different event produces a suite that fails everything for reasons that are not real.\n',
    )
    process.exit(2)
  }
}

// ---------------------------------------------------------------------------
// 1 — DEPLOYMENT TRUTH
// ---------------------------------------------------------------------------

const EDGE_FUNCTIONS = [
  'verify-access-code',
  'bind-staff-member',
  'transcribe-recording',
  'extract-rsvp',
]

async function step1() {
  console.log('\n1  DEPLOYMENT TRUTH')

  // Each function is gated (shared secret or a real payload), so a 2xx is not
  // what we are looking for. We are distinguishing "exists and ran" from "not
  // deployed". Supabase answers 404 with a BOOT_ERROR / NOT_FOUND body for a
  // function that was never shipped; a deployed one rejects us on its own
  // terms — 401 unauthorized, 400 bad request. Those are proof of life.
  for (const fn of EDGE_FUNCTIONS) {
    await check(`1.${EDGE_FUNCTIONS.indexOf(fn) + 1}`, `edge fn deployed: ${fn}`, async () => {
      const res = await fetchWithTimeout(`${SUPABASE_URL}/functions/v1/${fn}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const text = (await res.text()).slice(0, 200)
      if (res.status === 404 || /BOOT_ERROR|NOT_FOUND|Function not found/i.test(text)) {
        fail(`NOT DEPLOYED (HTTP ${res.status}: ${text})`)
      }
      if (res.status >= 500 && /boot|deploy/i.test(text)) {
        fail(`deployed but failing to boot (HTTP ${res.status}: ${text})`)
      }
      return `HTTP ${res.status} (responding)`
    }, { blocking: true })
  }

  await check('1.5', 'production serves the current commit', async () => {
    const res = await fetchWithTimeout(`${BASE_URL}/api/version`)
    const raw = await res.text()

    // A Next app answers an unknown route with its HTML 404 page, not JSON.
    // Reporting that as "Unexpected token '<'" tells the person running this
    // at 8am nothing; reporting it as "the route is not on this deployment"
    // tells them exactly what to do.
    let info
    try {
      info = JSON.parse(raw)
    } catch {
      fail(
        `/api/version is not on this deployment (HTTP ${res.status}, returned HTML). ` +
          'Deploy the current branch, then re-run — until then no deployment-truth check is possible.',
      )
    }
    if (!res.ok) fail(`/api/version returned HTTP ${res.status}`)
    if (!info.commit) fail('no commit SHA reported — this is not a Vercel deployment')

    let head = null
    try {
      head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    } catch {
      return `serving ${String(info.commit).slice(0, 8)} (local git unavailable, not compared)`
    }

    if (head !== info.commit) {
      let behind = ''
      try {
        const count = execFileSync('git', ['rev-list', '--count', `${info.commit}..HEAD`], {
          encoding: 'utf8',
        }).trim()
        behind = ` — production is ${count} commit(s) behind local HEAD`
      } catch {
        behind = ' — production commit is not in this clone (different branch?)'
      }
      fail(
        `production serves ${String(info.commit).slice(0, 8)} (${info.branch ?? 'unknown branch'}), ` +
          `local HEAD is ${head.slice(0, 8)}${behind}`,
      )
    }
    return `${head.slice(0, 8)} on ${info.branch ?? '?'} in ${info.region ?? '?'}`
  }, { blocking: true })

  await check('1.6', 'no Vercel SSO wall in front of the app', async () => {
    const res = await fetchWithTimeout(`${BASE_URL}/login`, { redirect: 'manual' })
    const location = res.headers.get('location') ?? ''
    if (location.includes('vercel.com/sso-api') || location.includes('/sso-api')) {
      fail('Deployment Protection is ON — staff would hit a Vercel login wall. Turn it off.')
    }
    if (res.status >= 400 && res.status !== 401) fail(`/login returned HTTP ${res.status}`)
    return `HTTP ${res.status}`
  }, { blocking: true })
}

// ---------------------------------------------------------------------------
// 2 — STORAGE
// ---------------------------------------------------------------------------

const BUCKETS = [
  { id: 'call-recordings', mustBePrivate: true },
  { id: 'delivery-proofs', mustBePrivate: true },
]

async function step2() {
  console.log('\n2  STORAGE')

  await check('2.1', 'buckets exist and are private', async () => {
    const res = await sb('/storage/v1/bucket')
    if (!res.ok) fail(`bucket list returned HTTP ${res.status}`)
    const all = await res.json()
    const byId = new Map(all.map((b) => [b.id, b]))
    const problems = []
    for (const want of BUCKETS) {
      const got = byId.get(want.id)
      if (!got) { problems.push(`${want.id} MISSING`); continue }
      if (want.mustBePrivate && got.public) problems.push(`${want.id} is PUBLIC — audio/photos would be world-readable`)
    }
    if (problems.length) fail(problems.join('; '))
    return BUCKETS.map((b) => b.id).join(', ')
  }, { blocking: true })

  // A bucket with no policy is not a private bucket, it is an inaccessible
  // one — uploads fail at the venue with a permissions error nobody can fix
  // mid-event. Anonymous upload must be refused, which proves a policy is
  // being evaluated rather than absent.
  await check('2.2', 'anonymous upload to call-recordings is refused', async () => {
    const res = await fetchWithTimeout(
      `${SUPABASE_URL}/storage/v1/object/call-recordings/smoke-anon-probe.txt`,
      {
        method: 'POST',
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, 'Content-Type': 'text/plain' },
        body: 'probe',
      },
    )
    if (res.ok) fail('an ANONYMOUS caller uploaded to call-recordings — the bucket policy is missing')
    return `refused with HTTP ${res.status}`
  })
}

// ---------------------------------------------------------------------------
// 3 — EVENT DATA
// ---------------------------------------------------------------------------

async function step3() {
  console.log(`\n3  EVENT DATA (${EVENT_CODE})`)

  const res = await sb(`/rest/v1/events?select=id,code,name&code=eq.${EVENT_CODE}`)
  const rows = res.ok ? await res.json() : []
  const event = rows[0]

  if (!event) {
    record('3.0', `event ${EVENT_CODE} exists`, 'BLOCK', 'no such event — nothing else in step 3 can run')
    return null
  }
  record('3.0', `event ${EVENT_CODE} exists`, 'PASS', `${event.name} (${event.id.slice(0, 8)})`)

  // Zero anywhere is a blocking failure: an event with no guests is an event
  // nobody can call, and it fails silently — the queue just looks finished.
  const required = [
    { id: '3.1', table: 'staff_members', label: 'staff members loaded' },
    { id: '3.2', table: 'guest_groups', label: 'families loaded' },
    { id: '3.3', table: 'guests', label: 'guests loaded' },
    { id: '3.4', table: 'hotels', label: 'hotels loaded' },
    { id: '3.5', table: 'rooms', label: 'rooms loaded' },
  ]

  for (const r of required) {
    await check(r.id, r.label, async () => {
      const n = await countRows(r.table, event.id)
      if (n === 0) fail(`ZERO rows in ${r.table} for ${EVENT_CODE}`)
      return `${n}`
    }, { blocking: true })
  }

  await check('3.6', 'a live access code exists for each role', async () => {
    const codesRes = await sb(
      `/rest/v1/event_access_codes?select=role,revoked_at,rotated_at&event_id=eq.${event.id}`,
    )
    if (!codesRes.ok) fail(`HTTP ${codesRes.status}`)
    const codes = await codesRes.json()
    const live = codes.filter((c) => !c.revoked_at && !c.rotated_at)
    const roles = new Set(live.map((c) => c.role))
    const missing = ['team', 'client'].filter((r) => !roles.has(r))
    if (missing.length) fail(`no live code for role(s): ${missing.join(', ')}`)
    return `${live.length} live (${[...roles].join(', ')})`
  }, { blocking: true })

  return event
}

// ---------------------------------------------------------------------------
// 4-7 — UI WALKS (delegated to Playwright)
// ---------------------------------------------------------------------------

function step4to7() {
  console.log('\n4-7  CRITICAL PATH (real login, deployed build)')

  // Playwright reads process.env, not .env.test — so every value the spec
  // needs has to be forwarded explicitly. Forgetting this made the whole walk
  // fail on "no team access code" while the code was sitting in .env.test:
  // a harness failure wearing a product failure's clothes.
  const run = spawnSync('npx', ['playwright', 'test', '--project=smoke', '--reporter=line'], {
    stdio: 'inherit',
    shell: true, // npx resolves through the shell on Windows
    env: {
      ...process.env,
      SMOKE_BASE_URL: BASE_URL,
      SMOKE_EVENT_CODE: EVENT_CODE,
      // `||` so an unset-but-present key does not shadow the fallback.
      SMOKE_TEAM_CODE: env.SMOKE_TEAM_CODE || '',
      SMOKE_CLIENT_CODE: env.SMOKE_CLIENT_CODE || '',
      E2E_TEAM_CODE: env.E2E_TEAM_CODE || '',
      E2E_CLIENT_CODE: env.E2E_CLIENT_CODE || '',
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
    },
  })

  if (run.error) {
    record('4-7', 'critical path walks', 'FAIL', `could not start Playwright: ${run.error.message}`)
    return false
  }
  if (run.status === 0) {
    record('4-7', 'critical path walks', 'PASS', 'see Playwright output above')
    return true
  }
  record(
    '4-7',
    'critical path walks',
    'FAIL',
    `Playwright exited ${run.status ?? 'on a signal'} — the named test above is the exact failing step`,
  )
  return false
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  preflight()

  console.log('='.repeat(78))
  console.log('T3 PRE-EVENT SMOKE')
  console.log(`  target   ${BASE_URL}`)
  console.log(`  supabase ${SUPABASE_URL}`)
  console.log(`  event    ${EVENT_CODE}`)
  console.log(`  started  ${new Date().toISOString()}`)
  console.log('='.repeat(78))

  await step1()
  await step2()
  await step3()
  step4to7()

  // -------------------------------------------------------------------------
  const elapsed = ((Date.now() - t0) / 1000).toFixed(0)
  const counts = results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {})
  const blocking = results.filter((r) => r.status === 'BLOCK')
  const failed = results.filter((r) => r.status === 'FAIL')

  console.log('\n' + '='.repeat(78))
  console.log(
    `SUMMARY  ${counts.PASS ?? 0} pass  ${failed.length} fail  ${blocking.length} blocking  ` +
      `${counts.WARN ?? 0} warn  ${counts.SKIP ?? 0} skip   (${elapsed}s)`,
  )
  console.log('='.repeat(78))

  if (blocking.length) {
    console.log('\nBLOCKING — do not run the event on this build:')
    for (const r of blocking) console.log(`  ${r.id}  ${r.label} — ${r.detail}`)
  }
  if (failed.length) {
    console.log('\nFAILED:')
    for (const r of failed) console.log(`  ${r.id}  ${r.label} — ${r.detail}`)
  }
  if (!blocking.length && !failed.length) {
    console.log('\nAll checks passed against the deployed build.')
  }

  process.exit(blocking.length || failed.length ? 1 : 0)
}

main().catch((err) => {
  console.error('\nSmoke harness itself crashed — this is not a product failure:')
  console.error(err)
  process.exit(3)
})
