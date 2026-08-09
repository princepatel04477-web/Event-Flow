import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

function parseEnvFile(path) {
  const out = {}
  const text = readFileSync(path, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
  }
  return out
}

const env = { ...parseEnvFile(join(process.cwd(), '.env.test')) }
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const EVENT_ID = env.E2E_EVENT_ID

async function main() {
  // 1. Existing delivery_proofs rows (insert-only — the constraint on backfill)
  const { count: proofs, error: pErr } = await db
    .from('delivery_proofs')
    .select('*', { count: 'exact', head: true })
    .eq('event_id', EVENT_ID)
  console.log('delivery_proofs in event:', proofs ?? 0, pErr?.message ?? '')

  const { count: allProofs, error: aErr } = await db
    .from('delivery_proofs')
    .select('*', { count: 'exact', head: true })
  console.log('delivery_proofs total (all events):', allProofs ?? 0, aErr?.message ?? '')

  // 2. Do any call_recordings exist?
  const { count: recordings } = await db.from('call_recordings').select('*', { count: 'exact', head: true })
  console.log('call_recordings total:', recordings ?? 0)

  // 3. Current events (for the cross-event test later)
  const { data: events } = await db.from('events').select('id, name, code')
  console.log('events:', JSON.stringify(events))

  // 4. delivery_proofs columns (to plan captured_by_staff)
  const { data: cols } = await db.from('delivery_proofs').select('*').limit(1)
  console.log('delivery_proofs sample keys:', cols && cols.length ? Object.keys(cols[0]).join(', ') : 'no rows')
}

main().catch((e) => { console.error(e); process.exit(1) })
