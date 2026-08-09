import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Loads e2e/.env.test and fails loudly if it is missing or incomplete.
 *
 * The service role key is TEST-ONLY. It lives in .env.test (gitignored) and
 * is read ONLY here and by e2e/helpers/db.ts — never by application code.
 * A missing env file means the suite cannot verify database state, and
 * running without that verification would report false passes, so we refuse
 * to start rather than degrade.
 */

const REQUIRED: (keyof TestEnv)[] = [
  'E2E_BASE_URL',
  'E2E_USER_A_EMAIL',
  'E2E_USER_A_PASSWORD',
  'E2E_USER_B_EMAIL',
  'E2E_USER_B_PASSWORD',
  'E2E_TEAM_CODE',
  'E2E_CLIENT_CODE',
  'E2E_TEAM_STAFF',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'E2E_EVENT_ID',
]

export interface TestEnv {
  E2E_BASE_URL: string
  E2E_USER_A_EMAIL: string
  E2E_USER_A_PASSWORD: string
  E2E_USER_B_EMAIL: string
  E2E_USER_B_PASSWORD: string
  /** Team access code (E-XXXXXX) for the test event. */
  E2E_TEAM_CODE: string
  /** Client access code (C-XXXXXX) for the test event. */
  E2E_CLIENT_CODE: string
  /** The staff member name the team login picks in the "Who are you?" step. */
  E2E_TEAM_STAFF: string
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  /** Anon key for Edge Function calls (minting code sessions). */
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string
  E2E_EVENT_ID: string
}

function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  const text = readFileSync(path, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    // Strip surrounding quotes.
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

export function loadTestEnv(): TestEnv {
  const path = join(process.cwd(), '.env.test')
  if (!existsSync(path)) {
    throw new Error(
      '.env.test is missing. Copy .env.test.example to .env.test and fill in the real ' +
        'credentials (staff accounts, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, E2E_EVENT_ID) ' +
        'before running the acceptance suite.',
    )
  }

  const raw = parseEnvFile(path)
  const env = raw as unknown as TestEnv

  const missing = REQUIRED.filter((key) => !env[key] || env[key].includes('replace-me'))
  if (missing.length > 0) {
    throw new Error(
      `.env.test is missing or has placeholder values for: ${missing.join(', ')}. ` +
        'Fill them in before running the acceptance suite.',
    )
  }

  return env
}

export default loadTestEnv()
