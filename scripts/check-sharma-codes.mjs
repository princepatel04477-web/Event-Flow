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
const sf = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const SHARMA = '565b5bf7-54bd-4e24-8d88-fde9358281e3'

async function main() {
  const { data } = await sf.from('event_access_codes').select('id, role, code_prefix, last_four, revoked_at, rotated_at, created_at').eq('event_id', SHARMA).order('created_at')
  console.log(`Found ${data?.length ?? 0} codes:`)
  for (const c of data ?? []) {
    console.log(`  role=${c.role} prefix=${c.code_prefix} last4=${c.last_four} revoked=${c.revoked_at ? 'YES' : 'no'} rotated=${c.rotated_at ? 'YES' : 'no'} created=${c.created_at}`)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
