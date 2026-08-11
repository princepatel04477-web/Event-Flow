// M2 verification probe — run: node scripts/verify-m2.mjs
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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
const sharmaId = '565b5bf7-54bd-4e24-8d88-fde9358281e3'
const e2eId = env.E2E_EVENT_ID

const sf = createClient(env.SUPABASE_URL, srKey, { auth: { persistSession: false } })

async function main() {
  console.log('=== 1. Staff members in Sharma Wedding ===')
  const { count: sc, error: sErr } = await sf
    .from('staff_members').select('id', { count: 'exact', head: true })
    .eq('event_id', sharmaId)
  console.log(`staff_members: ${sc ?? 'ERROR'} ${sErr ? `(${sErr.message})` : ''}`)

  console.log('\n=== 3. Row counts ===')
  const table = ['call_recordings','transcripts','rsvp_extractions','extraction_field_reviews']
  for (const t of table) {
    const { count, error } = await sf
      .from(t).select('*', { count: 'exact', head: true })
    console.log(`${t}: ${count ?? 'NULL'}${error ? ` (${error.message})` : ''}`)
  }

  // Look at the 6 call_recordings rows
  console.log('\n=== call_recordings detail ===')
  const { data: recs } = await sf.from('call_recordings').select('id, event_id, group_id, source, storage_path, duration_sec, consent_given, uploaded_by_staff').order('recorded_at', { ascending: false })
  if (recs) {
    for (const r of recs) {
      console.log(`  id=${r.id?.slice(0,8)} event=${r.event_id?.slice(0,8)} source=${r.source} consent=${r.consent_given} staff=${r.uploaded_by_staff?.slice(0,8)??'null'} path=${r.storage_path?.slice(0,60)}`)
    }
  }

  // Transcripts linked to those recordings
  console.log('\n=== transcripts for those recordings ===')
  const recordingIds = recs?.map(r => r.id) ?? []
  if (recordingIds.length) {
    const { data: txs } = await sf.from('transcripts').select('id, recording_id, status, provider').in('recording_id', recordingIds)
    for (const t of txs ?? []) {
      console.log(`  tx id=${t.id?.slice(0,8)} rec=${t.recording_id?.slice(0,8)} status=${t.status} provider=${t.provider}`)
    }
  }

  // 4. Entity grounding check — read the extract-rsvp function source
  console.log('\n=== 4. Extraction grounding ===')
  const fnSrc = readFileSync('supabase/functions/extract-rsvp/index.ts', 'utf8')
  const hasGrounding = fnSrc.includes('GROUNDING CONTEXT') || fnSrc.includes('buildGroundingContext')
  const hasMemberNames = fnSrc.includes('full_name') || fnSrc.includes('memberNames') || fnSrc.includes('member_names')
  const hasHotels = fnSrc.includes('hotels') || fnSrc.includes('hotel')
  const hasSchedule = fnSrc.includes('event_days') || fnSrc.includes('event_dates') || fnSrc.includes('event_date')
  console.log(`Grounding section present: ${hasGrounding}`)
  console.log(`Member names injected: ${hasMemberNames}`)
  console.log(`Hotels injected: ${hasHotels}`)
  console.log(`Event schedule injected: ${hasSchedule}`)
  console.log(`Function deployed? Check: npx supabase functions list --project-ref xktxnkuzplhzxkevwrcj`)
}

main().catch(e => { console.error(e); process.exit(1) })
