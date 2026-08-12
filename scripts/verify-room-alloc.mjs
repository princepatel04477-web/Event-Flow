// Room allocation verification — Step 0: precondition check
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

const SHARMA_ID = '565b5bf7-54bd-4e24-8d88-fde9358281e3'

async function main() {
  console.log('=== PRECONDITION: Room counts ===')
  const { count: rooms } = await sf.from('rooms').select('*', { count: 'exact', head: true }).eq('event_id', SHARMA_ID)
  console.log(`rooms in Sharma: ${rooms}`)

  const { count: hotels } = await sf.from('hotels').select('*', { count: 'exact', head: true }).eq('event_id', SHARMA_ID)
  console.log(`hotels in Sharma: ${hotels}`)

  const { count: groups } = await sf.from('guest_groups').select('*', { count: 'exact', head: true }).eq('event_id', SHARMA_ID)
  console.log(`guest_groups in Sharma: ${groups}`)

  const { count: guests } = await sf.from('guests').select('*', { count: 'exact', head: true }).eq('event_id', SHARMA_ID)
  console.log(`guests in Sharma: ${guests}`)

  const { count: assignments } = await sf.from('room_assignments').select('*', { count: 'exact', head: true }).eq('event_id', SHARMA_ID).is('released_at', null)
  console.log(`active assignments in Sharma: ${assignments}`)

  if (rooms === 0 || groups === 0) {
    console.log('\nSTOP — precondition not met. Import the hotel sheet and guest list first.')
    return
  }

  // Show a few rooms and groups for context
  const { data: sampleRooms } = await sf.from('rooms').select('id, hotel_id, room_number, capacity, max_capacity').eq('event_id', SHARMA_ID).limit(5)
  console.log('\nSample rooms:', JSON.stringify(sampleRooms, null, 2))

  const { data: confirmedGroups } = await sf.from('guest_groups').select('id, head_name, confirmed_pax, rsvp_status').eq('event_id', SHARMA_ID).eq('rsvp_status', 'confirmed').limit(3)
  console.log('\nSample confirmed groups:', JSON.stringify(confirmedGroups, null, 2))
}

main().catch(e => { console.error(e); process.exit(1) })
