/**
 * Generates e2e/ACCEPTANCE-REPORT.md from e2e/results.json (Playwright's JSON
 * reporter output). Run after `npx playwright test`.
 *
 * Scoring:
 *   Tier 0: 10 tests × 7 pts = 70
 *   Tier 1:  7 tests × 4 pts = 28
 *   Tier 2:  2 tests × 1 pt  = 2
 *   TOTAL: 100
 *   EVENT-READY: Tier 0 is 10/10 (all pass). NOT BUILT / MANUAL do NOT count
 *   as passes — the event cannot be declared ready on unbuilt features.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const RESULTS = join(process.cwd(), 'e2e', 'results.json')
const OUT = join(process.cwd(), 'e2e', 'ACCEPTANCE-REPORT.md')

const TIER0_TESTS = ['T0.1', 'T0.2', 'T0.3', 'T0.4', 'T0.5', 'T0.6', 'T0.7', 'T0.8', 'T0.9', 'T0.10']
const TIER1_TESTS = ['T1.1', 'T1.2', 'T1.3', 'T1.4', 'T1.5', 'T1.6', 'T1.7']
const TIER2_TESTS = ['T2.1', 'T2.2']

const NAMES = {
  'T0.1': 'Login persists',
  'T0.2': 'Import lands correctly',
  'T0.3': 'Import is idempotent',
  'T0.4': 'Guest list loads fast, windowed, search finds any guest',
  'T0.5': 'RSVP logging persists',
  'T0.6': 'Room double-booking rejected (UI)',
  'T0.7': 'Photo proof lands and is retrievable',
  'T0.8': 'Photo proof is tamper-evident',
  'T0.9': 'Timestamps are server-stamped',
  'T0.10': 'Excel export round-trips',
  'T1.1': 'Multi-user, no corruption',
  'T1.2': 'Duplicate delivery handled',
  'T1.3': 'Check-in / check-out persists',
  'T1.4': 'Calling (tel: link)',
  'T1.5': 'Arrival / departure tracking',
  'T1.6': 'Dashboard accuracy',
  'T1.7': 'Mobile viewport integrity',
  'T2.1': 'Vehicle allocation — no split, luggage capacity',
  'T2.2': 'Offline capture and sync',
}

function load() {
  if (!existsSync(RESULTS)) {
    throw new Error('e2e/results.json not found — run the suite first.')
  }
  return JSON.parse(readFileSync(RESULTS, 'utf8'))
}

function flatten(report) {
  const map = new Map()
  for (const suite of report.suites) {
    for (const spec of suite.specs) {
      const id = spec.title.split(' ')[0]
      const result = spec.tests[0]?.results[0]
      if (result) map.set(id, result)
    }
  }
  return map
}

function classify(result) {
  if (result.status === 'passed') return 'PASS'
  if (result.status === 'skipped') {
    const msg = result.error?.message ?? result.errors?.[0]?.message ?? ''
    if (/NOT BUILT/i.test(msg)) return 'NOT BUILT'
    if (/MANUAL/i.test(msg)) return 'MANUAL'
    return 'SKIP'
  }
  return 'FAIL'
}

function main() {
  const report = load()
  const results = flatten(report)

  const rows = []
  const failures = []
  const manual = []
  const notBuilt = []

  let t0Pass = 0
  let t1Pass = 0
  let t2Pass = 0

  for (const id of [...TIER0_TESTS, ...TIER1_TESTS, ...TIER2_TESTS]) {
    const result = results.get(id)
    if (!result) {
      rows.push(`| ${id} | ${NAMES[id]} | MISSING | — |`)
      failures.push(`${id}: no result recorded (suite may not have run)`)
      continue
    }
    const cls = classify(result)
    const tier = id.startsWith('T0') ? '0' : id.startsWith('T1') ? '1' : '2'
    if (cls === 'PASS') {
      if (tier === '0') t0Pass++
      else if (tier === '1') t1Pass++
      else t2Pass++
    }
    rows.push(`| ${id} | ${NAMES[id]} | ${cls} | ${result.duration.toFixed(0)}ms |`)
    if (cls === 'FAIL') {
      const msg = (result.error?.message ?? result.errors?.[0]?.message ?? 'no message').split('\n')[0]
      failures.push(`**${id}** — expected: see test; actual: \`${msg}\``)
    }
    if (cls === 'MANUAL') manual.push(`**${id}** — ${NAMES[id]}`)
    if (cls === 'NOT BUILT') notBuilt.push(`**${id}** — ${NAMES[id]}`)
  }

  const t0Score = t0Pass * 7
  const t1Score = t1Pass * 4
  const t2Score = t2Pass
  const total = t0Score + t1Score + t2Score
  const eventReady = t0Pass === 10 ? 'YES' : 'NO'

  const lines = []
  lines.push('# Nuvent — Acceptance Report')
  lines.push('')
  lines.push(`Generated ${new Date().toISOString()}`)
  lines.push('')
  lines.push('## Scoreboard')
  lines.push('')
  lines.push(`- Tier 0: ${t0Pass}/10 → ${t0Score}/70`)
  lines.push(`- Tier 1: ${t1Pass}/7 → ${t1Score}/28`)
  lines.push(`- Tier 2: ${t2Pass}/2 → ${t2Score}/2`)
  lines.push(`- **TOTAL: ${total}/100**`)
  lines.push(`- **EVENT-READY: ${eventReady}** (requires Tier 0 at 10/10; NOT BUILT/MANUAL do not count as passes)`)
  lines.push('')
  lines.push('## Results')
  lines.push('')
  lines.push('| ID | Test | Result | Duration |')
  lines.push('|---|---|---|---|')
  lines.push(...rows)
  lines.push('')
  lines.push('## Failures')
  lines.push('')
  if (failures.length === 0) {
    lines.push('None.')
  } else {
    lines.push(...failures.map((f) => `- ${f}`))
  }
  lines.push('')
  lines.push('## MANUAL — cannot be automated')
  lines.push('')
  if (manual.length === 0) {
    lines.push('None.')
  } else {
    lines.push(...manual.map((m) => `- ${m} — see test body for the reason.`))
  }
  lines.push('')
  lines.push('## NOT BUILT — the feature does not exist in this build')
  lines.push('')
  if (notBuilt.length === 0) {
    lines.push('None.')
  } else {
    lines.push(...notBuilt.map((n) => `- ${n} — the UI for this flow does not exist; reported NOT BUILT rather than fabricated.`))
  }
  lines.push('')
  lines.push('## Notes')
  lines.push('')
  lines.push('- The acceptance doc\'s SQL uses `family_heads` / `room_allocations` / `delivered_by` / `created_at`; the real schema uses `guest_groups` / `room_assignments` / `captured_by` / `recorded_at`. Tests here use the real names.')
  lines.push('- `delivery_proofs` is insert-only by design; proof counts in re-runs are deltas, and T0.8 verifies the trigger holds against the service role.')
  lines.push('- Run the suite twice to confirm stable scores.')

  writeFileSync(OUT, lines.join('\n') + '\n')
  console.log(`Wrote ${OUT}`)
  console.log(`Scoreboard: Tier 0 ${t0Pass}/10 → ${t0Score}/70 · Tier 1 ${t1Pass}/7 → ${t1Score}/28 · Tier 2 ${t2Pass}/2 → ${t2Score}/2 · TOTAL ${total}/100 · EVENT-READY ${eventReady}`)
}

main()
