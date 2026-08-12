// Issue a client access code for Sharma Wedding
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { createHash } from 'node:crypto'

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
function generateCode(prefix) {
  const chars = Array.from({ length: 6 }, () => ALPHABET[Math.floor(randomBytes(1)[0] / 256 * ALPHABET.length)])
  return `${prefix}-${chars.join('')}`
}

const env = { ...parseEnv('.env.local'), ...parseEnv('.env.test') }
const sf = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const SHARMA_ID = '565b5bf7-54bd-4e24-8d88-fde9358281e3'

async function main() {
  // Check existing codes
  const { data: existing } = await sf.from('event_access_codes').select('id, role, code_prefix, last_four, revoked_at, rotated_at').eq('event_id', SHARMA_ID)
  console.log('Existing codes:', existing?.length ?? 0)

  // Generate and issue via the RPC
  const code = generateCode('C')
  const hash = createHash('sha256').update(code).digest('hex')
  const lastFour = code.slice(-4)

  console.log(`Generated code: ${code}`)
  console.log(`Hash: ${hash}`)
  console.log(`Last four: ${lastFour}`)

  // Direct insert — the RPC needs an admin auth session, but service role
  // can insert directly since there's no existing client code to rotate.
  const { data: inserted, error } = await sf
    .from('event_access_codes')
    .insert({
      event_id: SHARMA_ID,
      role: 'client',
      code_hash: hash,
      code_prefix: 'C',
      last_four: lastFour,
    })
    .select('id')
    .single()

  if (error) {
    console.error('Insert error:', error)
    return
  }

  console.log('Issued successfully.')
  console.log('Client code:', code)
  console.log('Use this code at /login')
  console.log('Inserted id:', inserted?.id)
}

main().catch(e => { console.error(e); process.exit(1) })
