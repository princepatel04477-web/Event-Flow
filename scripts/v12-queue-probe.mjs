/**
 * V12 call-list probe — who is at the head of the calling list, and why?
 *
 * `CallNext` shows the head of `v_rsvp_queue` under the default "Still to call"
 * preset, ordered `attempt_count asc, last_attempt_at asc nulls first, priority
 * desc, head_name asc`, and then offsets by a random 0-11. The task "call the
 * next family" cannot be asserted against a family the suite did not create, so
 * the seed puts one at the head — this prints the list as the app orders it, to
 * confirm that is where it landed.
 *
 *   node scripts/v12-queue-probe.mjs
 */
import { readFileSync } from 'node:fs'

import { createClient } from '@supabase/supabase-js'

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
    /* nothing */
  }
  return out
}

const env = { ...parseEnv('.env.local'), ...parseEnv('.env.test') }
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const EVENT = '85e716fc-ab45-4c7e-be09-7223dbf68d2b'

const { data, error } = await db
  .from('v_rsvp_queue')
  .select('group_id, head_name, primary_mobile, rsvp_status, attempt_count, last_attempt_at, priority, is_locked')
  .eq('event_id', EVENT)
  .in('rsvp_status', ['not_started', 'attempted'])
  .order('attempt_count', { ascending: true })
  .order('last_attempt_at', { ascending: true })
  .order('priority', { ascending: false })
  .order('head_name', { ascending: true })
  .limit(14)

if (error) {
  console.log(`ERR ${error.message}`)
  process.exit(1)
}

console.log('head of the calling list, as CallNext orders it:')
for (const [i, row] of (data ?? []).entries()) {
  console.log(
    `  ${String(i).padStart(2)}  ${(row.head_name ?? '').padEnd(38)} attempts=${row.attempt_count} ` +
      `last=${row.last_attempt_at ?? 'null'} locked=${row.is_locked} mobile=${row.primary_mobile ?? 'NONE'}`,
  )
}

const v12 = (data ?? []).filter((r) => (r.head_name ?? '').startsWith('V12-') || (r.head_name ?? '').startsWith('0 V12-'))
console.log(`\nV12- families inside the first 14: ${JSON.stringify(v12.map((r) => r.head_name))}`)
