import { createClient } from 'npm:@supabase/supabase-js@2'
import { SignJWT, jwtVerify } from 'npm:jose@5'

/**
 * bind-staff-member — attach a staff identity to an existing code-auth JWT.
 *
 * After a team code login, the caller picks their name from the event's staff
 * list. Writes are gated on `app.has_staff_identity(event_id)`, which reads
 * the `staff_member_id` CLAIM — not a cookie. So the session must be RE-MINTED
 * with that claim, not amended client-side (a client cannot re-sign a JWT).
 *
 * This function:
 *   1. Verifies the caller's existing code JWT (signature + expiry). A token
 *      that does not verify is rejected — this is not a login endpoint, it
 *      only binds identity onto an already-valid session.
 *   2. Checks the chosen staff member belongs to that same event, is active,
 *      and (for a team session) that the JWT is a team session.
 *   3. Re-signs a new JWT with the SAME claims plus `staff_member_id`, same
 *      expiry as the original.
 *
 * SECURITY (do not weaken):
 *   * staff_member_id must belong to the JWT's event — never a caller-picked
 *     event.
 *   * The staff member must be `is_active` — deactivated staff cannot write.
 *   * Client (C-code) sessions are read-only and never bind a staff member.
 *
 * Rate limiting: binding is cheap and follows an already-rate-limited login;
 * it is not a brute-force surface (the staff id is a uuid the caller already
 * holds from the picker list). No separate limiter.
 */

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const jwtSecret = Deno.env.get('APP_JWT_SECRET')!

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
})

let signKey: CryptoKey | null = null
async function getSignKey(): Promise<CryptoKey> {
  if (signKey) return signKey
  signKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(jwtSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    // sign (for the re-minted JWT) AND verify (to check the incoming one).
    ['sign', 'verify'],
  )
  return signKey
}

async function mintJwt(opts: {
  eventId: string
  appRole: 'team' | 'client'
  accessCodeId: string
  staffMemberId: string
  expirySec: number
}): Promise<string> {
  const key = await getSignKey()
  return await new SignJWT({
    role: 'authenticated',
    app_role: opts.appRole,
    event_id: opts.eventId,
    access_code_id: opts.accessCodeId,
    staff_member_id: opts.staffMemberId,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
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

  let body: { token?: string; staff_member_id?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }

  const token = typeof body.token === 'string' && body.token ? body.token : ''
  const staffMemberId = typeof body.staff_member_id === 'string' && body.staff_member_id ? body.staff_member_id : ''

  if (!token || !staffMemberId) {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }

  // 1. Verify the existing code JWT. A bad token is a hard no — binding is
  //    only ever onto a valid session.
  let claims: { app_role?: unknown; event_id?: unknown; access_code_id?: unknown; exp?: number }
  try {
    const key = await getSignKey()
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] })
    claims = payload
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.error('bind-staff-member: jwtVerify failed:', detail)
    return Response.json({ error: 'Invalid session', detail }, { status: 401 })
  }

  const appRole = claims.app_role
  const eventId = claims.event_id
  const accessCodeId = claims.access_code_id
  if (appRole !== 'team' || typeof eventId !== 'string' || typeof accessCodeId !== 'string') {
    // Client sessions never bind a staff member; a malformed claim is rejected.
    return Response.json({ error: 'Invalid session' }, { status: 401 })
  }

  // 2. The staff member must belong to the JWT's event and be active.
  const { data: staff, error } = await db
    .from('staff_members')
    .select('id, event_id, is_active')
    .eq('id', staffMemberId)
    .maybeSingle()

  if (error || !staff) {
    return Response.json({ error: 'Staff member not found' }, { status: 404 })
  }
  if (staff.event_id !== eventId) {
    // Cross-event binding is the one thing that must never happen — it would
    // attribute one event's writes to another event's staff.
    return Response.json({ error: 'Staff member not on this event' }, { status: 403 })
  }
  if (!staff.is_active) {
    return Response.json({ error: 'This staff member is not active' }, { status: 403 })
  }

  // 3. Re-mint with the staff claim, preserving the original expiry window.
  const expirySec = claims.exp
    ? Math.max(60, claims.exp - Math.floor(Date.now() / 1000))
    : 60 * 60 * 24 * 30

  const newToken = await mintJwt({
    eventId,
    appRole,
    accessCodeId,
    staffMemberId,
    expirySec,
  })

  return Response.json(
    { access_token: newToken },
    { headers: { 'Access-Control-Allow-Origin': '*' } },
  )
})
