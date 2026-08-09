/**
 * Seeds the acceptance event to ~543 total guests so the suite runs at the
 * real 238-family / 543-guest scale (the 26-second guest list only showed
 * up at scale). Idempotent: counts existing SEED-543 guests and tops up to
 * the target — an interrupted run resumes, a completed run adds nothing.
 *
 * Run: node scripts/seed-543.mjs   (reads .env.test)
 *
 * The seed deliberately uses a SEED- prefix so it is identifiable, and the
 * acceptance tests exclude SEED-* from their count/timing assertions when
 * they need a clean working set.
 *
 * Names: a mix of Latin and Devanagari first names + family surnames, so
 * the search tests (Latin + Devanagari partial matching) have real data at
 * scale. Each family gets one head guest (matching the import path).
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

/** Target total guests in the event after seeding. */
const TARGET_GUESTS = 543
const SEED_PREFIX = 'SEED-543'

// Realistic Indian first names and surnames (Latin + Devanagari).
const FIRST_LATIN = ['Aarav', 'Vihaan', 'Aditya', 'Vivaan', 'Arjun', 'Sai', 'Reyansh', 'Krishna', 'Ishaan', 'Kabir', 'Rohan', 'Aryan', 'Dhruv', 'Yash', 'Dev', 'Ayaan', 'Shaurya', 'Pranav', 'Karthik', 'Rahul', 'Ravi', 'Suresh', 'Anil', 'Vikram', 'Nikhil', 'Sameer', 'Rajesh', 'Manoj', 'Amit', 'Rakesh']
const FIRST_DEVANAGARI = ['आरव', 'विहान', 'आदित्य', 'अर्जुन', 'रोहन', 'कृष्ण', 'ईशान', 'कबीर', 'ध्रुव', 'यश', 'राहुल', 'सुरेश', 'अनिल', 'विक्रम', 'निखिल', 'समीर', 'राजेश', 'मनोज']
const SURNAMES = ['Patel', 'Shah', 'Mehta', 'Desai', 'Joshi', 'Trivedi', 'Vyas', 'Pandya', 'Raval', 'Dave', 'Soni', 'Bhatt', 'Kothari', 'Chauhan', 'Solanki', 'Parmar', 'Thakor', 'Vaghela', 'Rathod', 'Barot']

function mobileFor(i) {
  // Deterministic 10-digit Indian mobile, distinct per index.
  return String(7000000000 + i * 131).slice(0, 10)
}

function nameFor(i) {
  if (i === 0) return `${SEED_PREFIX}-SENTINEL`
  const first = i % 2 === 0 ? FIRST_LATIN[i % FIRST_LATIN.length] : FIRST_DEVANAGARI[i % FIRST_DEVANAGARI.length]
  const surname = SURNAMES[i % SURNAMES.length]
  return `${SEED_PREFIX} ${first} ${surname} ${i}`
}

async function countExisting() {
  const { count } = await db
    .from('guests')
    .select('*', { count: 'exact', head: true })
    .eq('event_id', EVENT_ID)
    .ilike('full_name', `${SEED_PREFIX}%`)
  return count ?? 0
}

async function main() {
  const existing = await countExisting()
  const need = Math.max(0, TARGET_GUESTS - existing)
  console.log(`SEED-543 guests present: ${existing}; target ${TARGET_GUESTS}; adding ${need}.`)

  if (need === 0) return

  // Insert in batches; deterministic names mean a re-run never duplicates
  // (the count above is the source of truth).
  const BATCH = 100
  let inserted = 0
  for (let i = 0; i < need; i += BATCH) {
    const slice = Array.from({ length: Math.min(BATCH, need - i) }, (_, j) => existing + i + j)
    for (const idx of slice) {
      const name = nameFor(idx)
      const { data: group, error: gErr } = await db
        .from('guest_groups')
        .insert({ event_id: EVENT_ID, head_name: name, primary_mobile: mobileFor(idx), expected_pax: 1, rsvp_status: 'not_started' })
        .select('id')
        .single()
      if (gErr) {
        console.error(`group insert failed for ${name}: ${gErr.message}`)
        process.exit(1)
      }
      const { error: guestErr } = await db
        .from('guests')
        .insert({ event_id: EVENT_ID, group_id: group.id, full_name: name, is_head: true })
      if (guestErr) {
        console.error(`guest insert failed for ${name}: ${guestErr.message}`)
        process.exit(1)
      }
      inserted++
    }
    console.log(`  inserted ${inserted} so far (total SEED-543 now ${existing + inserted})...`)
  }

  const after = await countExisting()
  console.log(`Done. SEED-543 guests now: ${after}.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
