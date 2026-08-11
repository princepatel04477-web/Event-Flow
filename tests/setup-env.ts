/**
 * Load .env.test into process.env before any test module is imported.
 *
 * The DB-backed suites gate on `process.env.SUPABASE_SERVICE_ROLE_KEY` and
 * SKIP SILENTLY when it is absent. That is how tests/hotels.test.ts's two
 * "cross-event isolation" tests came to have never executed: they need
 * E2E_EVENT_ID_2, which was never set, so they `return`ed on the first line
 * and the suite reported green.
 *
 * Loading the file here means "did it run" stops depending on whether the
 * person at the keyboard remembered to export anything.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

for (const file of ['.env.test', '.env.local']) {
  const path = join(process.cwd(), file)
  if (!existsSync(path)) continue

  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    // A real environment variable always wins, so CI and one-off overrides
    // keep working.
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = value
    }
  }
}
