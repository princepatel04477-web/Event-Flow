/**
 * Clean up the probe data created by verify-a0.mjs.
 * The call_recordings row is insert-only (by design) and cannot be removed —
 * that is the trigger working. Everything else is deletable via the service
 * role. Run: node scripts/clean-a0-probe.mjs
 */
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

const env = { ...parseEnvFile(join(process.cwd(), '.env.local')), ...parseEnvFile(join(process.cwd(), '.env.test')) }
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const EVENT_ID = env.E2E_EVENT_ID

async function main() {
  // Find groups matching the A0 probe prefix.
  const { data: groups } = await db.from('guest_groups').select('id').eq('event_id', EVENT_ID).ilike('head_name', 'A0-VERIFY-%')
  for (const g of groups ?? []) {
    const { data: extracts } = await db.from('rsvp_extractions').select('id').eq('event_id', EVENT_ID).eq('group_id', g.id)
    for (const ex of extracts ?? []) {
      await db.from('extraction_field_reviews').delete().eq('event_id', EVENT_ID).eq('extraction_id', ex.id)
      await db.from('rsvp_extractions').delete().eq('id', ex.id)
    }
    const { data: transcripts } = await db.from('transcripts').select('id').eq('event_id', EVENT_ID).eq('group_id', g.id)
    for (const t of transcripts ?? []) {
      await db.from('transcripts').delete().eq('id', t.id)
    }
    await db.from('call_attempts').delete().eq('event_id', EVENT_ID).eq('group_id', g.id)
    await db.from('guests').delete().eq('event_id', EVENT_ID).eq('group_id', g.id)
    await db.from('guest_groups').delete().eq('id', g.id)
    console.log('cleaned group', g.id)
  }
  // The call_recordings row for the probe is intentionally left — insert-only.
  const { data: recs } = await db.from('call_recordings').select('id, storage_path').eq('event_id', EVENT_ID).ilike('storage_path', `%${EVENT_ID}%`)
  console.log(`call_recordings remaining (insert-only, expected): ${(recs ?? []).length}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
