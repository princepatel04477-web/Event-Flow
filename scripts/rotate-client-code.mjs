// Rotate client code — unmask old as rotated, insert new with fresh plaintext
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { randomBytes, createHash } from 'node:crypto'

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

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
function generate() { const c = Array.from({length:6},()=>ALPHABET[Math.floor(randomBytes(1)[0]/256*ALPHABET.length)]).join(''); return `C-${c}` }

const env = { ...parseEnv('.env.local'), ...parseEnv('.env.test') }
const sf = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const SHARMA = '565b5bf7-54bd-4e24-8d88-fde9358281e3'

async function main() {
  // Get old client code
  const { data: old } = await sf.from('event_access_codes').select('id').eq('event_id', SHARMA).eq('role', 'client').single()
  if (!old) { console.log('No existing client code — insert fresh'); return }

  // Rotate: mark old as rotated
  await sf.from('event_access_codes').update({ rotated_at: new Date().toISOString() }).eq('id', old.id)

  // Insert new
  const code = generate()
  const hash = createHash('sha256').update(code).digest('hex')
  const lastFour = code.slice(-4)

  const { error } = await sf.from('event_access_codes').insert({ event_id: SHARMA, role: 'client', code_hash: hash, code_prefix: 'C', last_four: lastFour })

  if (error) { console.error(error); return }
  console.log('Rotated. New client code:', code)
  process.exit(0)
}
main().catch(e => { console.error(e); process.exit(1) })
