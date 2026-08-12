import { createClient } from 'npm:@supabase/supabase-js@2'
import { SignJWT } from 'npm:jose@5'

/**
 * verify-access-code — code-based login for team and client.
 *
 * Takes an access code (E-XXXXXX / C-XXXXXX), hashes it, looks up a
 * non-revoked match, rate-limits by device and IP, logs every attempt,
 * and on success mints a Supabase JWT with the claims RLS reads:
 *   role           = 'authenticated'   (must be a real Postgres role)
 *   app_role       = 'team' | 'client'
 *   event_id       = uuid
 *   access_code_id = uuid
 *   staff_member_id= uuid (added later by the staff picker — not here)
 *
 * SECURITY RULES (do not weaken):
 *   * Codes are stored as SHA-256. We hash the input and compare hashes.
 *   * Failure always returns the SAME generic error — never reveal
 *     whether the prefix was valid, whether the code exists, or which
 *     part was wrong (enumeration guard).
 *   * Rate limiting is mandatory: 5 attempts/device/15min then 1h
 *     lockout; 20 attempts/IP/hour. Counted from login_attempt_log.
 *   * Every attempt is logged (IP, device, prefix, success) so admin
 *     can spot an attack in progress.
 */

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// The legacy JWT secret, set as APP_JWT_SECRET (the CLI refuses names
// starting with SUPABASE_). PostgREST validates tokens against this
// secret, so a JWT signed with it is trusted by RLS.
const jwtSecret = Deno.env.get('APP_JWT_SECRET')!

const CODE_ALPHABET = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/
const RATE_DEVICE_MAX = 5
const RATE_DEVICE_WINDOW_MS = 15 * 60 * 1000
// Session lifetime. Was 30 days, which meant a revoked code left a lost
// phone working for a month. app.code_is_live() now ends such a session
// on its next request, so this is the fallback ceiling, not the control:
// 7 days is generous for a 4-day event and keeps a stolen token from
// outliving the wedding.
const SESSION_EXPIRY_SEC = 60 * 60 * 24 * 7

const RATE_DEVICE_LOCK_MS = 60 * 60 * 1000
const RATE_IP_MAX = 20
const RATE_IP_WINDOW_MS = 60 * 60 * 1000

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
})

/** sha256 hex of the normalized code. */
async function hashCode(code: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Normalize a typed code: uppercase, strip the hyphen, validate the
 * alphabet. Returns null if the shape is wrong (never says why).
 */
function normalizeCode(raw: string): { prefix: 'E' | 'C'; body: string; full: string } | null {
  const upper = raw.trim().toUpperCase().replace(/-/g, '')
  if (upper.length !== 7) return null
  const prefix = upper[0]
  if (prefix !== 'E' && prefix !== 'C') return null
  const body = upper.slice(1)
  if (!CODE_ALPHABET.test(body)) return null
  return { prefix, body, full: upper }
}

async function deviceLocked(deviceId: string): Promise<boolean> {
  const since = new Date(Date.now() - RATE_DEVICE_WINDOW_MS).toISOString()
  const { count } = await db
    .from('login_attempt_log')
    .select('*', { count: 'exact', head: true })
    .eq('device_id', deviceId)
    .eq('succeeded', false)
    .gte('created_at', since)
  if ((count ?? 0) < RATE_DEVICE_MAX) return false

  const { data: oldest } = await db
    .from('login_attempt_log')
    .select('created_at')
    .eq('device_id', deviceId)
    .eq('succeeded', false)
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(1)
  if (!oldest?.[0]) return false
  const lockUntil = new Date(new Date(oldest[0].created_at).getTime() + RATE_DEVICE_LOCK_MS)
  return lockUntil > new Date()
}

async function ipRateLimited(ip: string): Promise<boolean> {
  const since = new Date(Date.now() - RATE_IP_WINDOW_MS).toISOString()
  const { count } = await db
    .from('login_attempt_log')
    .select('*', { count: 'exact', head: true })
    .eq('ip_address', ip)
    .eq('succeeded', false)
    .gte('created_at', since)
  return (count ?? 0) >= RATE_IP_MAX
}

async function logAttempt(opts: {
  deviceId: string
  ip: string
  prefix: string
  succeeded: boolean
  eventId?: string
}) {
  await db.from('login_attempt_log').insert({
    device_id: opts.deviceId,
    ip_address: opts.ip,
    attempted_prefix: opts.prefix,
    succeeded: opts.succeeded,
    event_id: opts.eventId ?? null,
  })
}

let signKey: CryptoKey | null = null
async function getSignKey(): Promise<CryptoKey> {
  if (signKey) return signKey
  signKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(jwtSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return signKey
}

async function mintJwt(opts: {
  eventId: string
  appRole: 'team' | 'client'
  accessCodeId: string
  expirySec: number
}): Promise<string> {
  const key = await getSignKey()
  return await new SignJWT({
    // role MUST be an existing Postgres role for PostgREST to route the
    // request to the `TO authenticated` policies. The app role (team /
    // client) lives in the custom app_role claim, read by RLS helpers.
    role: 'authenticated',
    app_role: opts.appRole,
    event_id: opts.eventId,
    access_code_id: opts.accessCodeId,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    // sub must be a UUID — PostgREST casts it to auth.uid(). There is no
    // real user for a code session, so we use the access_code_id (a uuid)
    // as the stable subject. RLS identity comes from app_role/event_id/
    // staff_member_id claims, never from sub.
    .setSubject(opts.accessCodeId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + opts.expirySec)
    .sign(key)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  }

  let body: { code?: string; device_id?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid code' }, { status: 401 })
  }

  const code = typeof body.code === 'string' ? body.code : ''
  const deviceId = typeof body.device_id === 'string' && body.device_id ? body.device_id : 'unknown'
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'

  const normalized = normalizeCode(code)
  const generic401 = () => Response.json({ error: 'Invalid code' }, { status: 401 })
  const generic429 = () => Response.json({ error: 'Too many attempts. Try again later.' }, { status: 429 })

  if (!normalized) {
    await logAttempt({ deviceId, ip, prefix: code.slice(0, 1).toUpperCase() || '?', succeeded: false })
    return generic401()
  }

  if (await deviceLocked(deviceId)) return generic429()
  if (await ipRateLimited(ip)) return generic429()

  const hash = await hashCode(normalized.full)
  const { data: match, error } = await db
    .from('event_access_codes')
    .select('id, event_id, role, revoked_at, rotated_at')
    .eq('code_hash', hash)
    .maybeSingle()

  if (error || !match || match.revoked_at || match.rotated_at) {
    await logAttempt({ deviceId, ip, prefix: normalized.prefix, succeeded: false })
    return generic401()
  }

  const eventId = match.event_id as string
  const appRole = match.role as 'team' | 'client'

  await logAttempt({ deviceId, ip, prefix: normalized.prefix, succeeded: true, eventId })

  const token = await mintJwt({
    eventId,
    appRole,
    accessCodeId: match.id as string,
    expirySec: SESSION_EXPIRY_SEC,
  })

  return Response.json(
    {
      access_token: token,
      token_type: 'bearer',
      expires_in: SESSION_EXPIRY_SEC,
      app_role: appRole,
      event_id: eventId,
    },
    { headers: { 'Access-Control-Allow-Origin': '*' } },
  )
})
