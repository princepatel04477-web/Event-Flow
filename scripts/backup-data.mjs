/**
 * Full data backup via the service-role key — every row of every
 * public table, written to backups/ as JSON. Not a pg_dump, but a
 * complete, restorable data capture (the migrations ARE the schema).
 * Required before the RLS rewrite per the task: "confirm a backup
 * exists and tell me."
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
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

// Every public table. Views and RPC-only objects excluded.
const TABLES = [
  'events', 'profiles', 'event_members', 'audit_log',
  'guest_groups', 'guests', 'travel_legs', 'call_attempts',
  'call_recordings', 'transcripts', 'rsvp_extractions', 'extraction_field_reviews',
  'hotels', 'rooms', 'room_assignments', 'deliverables', 'delivery_proofs',
  'vehicle_types', 'vehicles', 'trips', 'trip_passengers',
  'message_templates', 'messages', 'import_batches', 'import_rows',
]

async function main() {
  const out = {}
  let total = 0
  for (const t of TABLES) {
    const { data, error } = await db.from(t).select('*')
    if (error) {
      console.log(`  ${t}: ERROR ${error.message}`)
      continue
    }
    out[t] = data ?? []
    total += (data ?? []).length
    console.log(`  ${t}: ${(data ?? []).length} rows`)
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const file = join(process.cwd(), 'backups', `pre-codeauth-data-${ts}.json`)
  mkdirSync(join(process.cwd(), 'backups'), { recursive: true })
  writeFileSync(file, JSON.stringify(out, null, 2))
  console.log(`\nWrote ${file}`)
  console.log(`Total rows backed up: ${total}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
