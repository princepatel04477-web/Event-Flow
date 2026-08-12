// Step 1 diagnostic — report all 10 extractions, explain 10 from 6
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

function parseEnv(path) {
  const out = {}
  const text = readFileSync(path, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq > 0) out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
  }
  return out
}

const env = { ...parseEnv('.env.local'), ...parseEnv('.env.test') }
const srKey = env.SUPABASE_SERVICE_ROLE_KEY
const sf = createClient(env.SUPABASE_URL, srKey, { auth: { persistSession: false } })

async function main() {
  // 1a — All 10 extractions
  console.log('=== 1a: All 10 rsvp_extractions rows ===')
  const { data: ex, error: exErr } = await sf
    .from('rsvp_extractions')
    .select('id, created_at, transcript_id, event_id, group_id, status')
    .order('created_at', { ascending: true })

  if (exErr) { console.error('EXTRACTIONS ERROR:', exErr); return }
  console.log(`Total: ${ex.length} rows\n`)
  for (const e of ex) {
    console.log(`id=${e.id?.slice(0,8)} event=${e.event_id?.slice(0,8)} group=${e.group_id?.slice(0,8)??'null'} tx=${e.transcript_id?.slice(0,8)??'null'} status=${e.status} created_at=${e.created_at}`)
  }

  // 1b — Show the 6 transcripts + their recordings
  console.log('\n=== 1b: All 6 transcripts ===')
  const { data: tx } = await sf.from('transcripts').select('id, recording_id, status, provider').order('created_at')
  for (const t of tx ?? []) {
    console.log(`tx=${t.id?.slice(0,8)} rec=${t.recording_id?.slice(0,8)} status=${t.status} provider=${t.provider}`)
  }

  console.log('\n=== 1b: All 6 recordings ===')
  const { data: recs } = await sf.from('call_recordings').select('id, event_id, source, consent_given, uploaded_by_staff')
  for (const r of recs ?? []) {
    console.log(`rec=${r.id?.slice(0,8)} evt=${r.event_id?.slice(0,8)} src=${r.source} consent=${r.consent_given} staff=${r.uploaded_by_staff?.slice(0,8)??'null'}`)
  }

  // 1b — Map: how many extractions per transcript?
  console.log('\n=== 1b: Extractions per transcript ===')
  const map = new Map()
  for (const e of ex) {
    const key = e.transcript_id ?? 'ORPHAN'
    map.set(key, (map.get(key) ?? 0) + 1)
  }
  for (const [k, v] of map) {
    if (k === 'ORPHAN') console.log(`ORPHAN (no transcript): ${v} extraction(s)`)
    else console.log(`${k.slice(0,8)}: ${v} extraction(s)`)
  }

  // 1c — Check extraction_field_reviews
  console.log('\n=== 1c: extraction_field_reviews ===')
  const { data: fv } = await sf.from('extraction_field_reviews').select('id, extraction_id, field_name, reviewed_by').order('created_at')
  console.log(`Total field reviews: ${fv?.length ?? 0}`)
}

main().catch(e => { console.error(e); process.exit(1) })
