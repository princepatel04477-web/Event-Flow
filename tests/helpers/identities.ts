/**
 * Real sessions for T1 — the SAME session type staff actually use.
 *
 * WHY THIS FILE EXISTS, AND WHY IT WAS REWRITTEN ONCE
 *
 * First attempt provisioned GoTrue email/password users and made them
 * `event_members.role = 'event_team'`. Every write they attempted was refused
 * with 42501, which turned out not to be a test bug:
 *
 *     app.is_staff(p_event_id) =
 *       app.is_admin()
 *       OR (app.jwt_event_id() = p_event_id
 *           AND app.jwt_app_role() = 'team'
 *           AND app.code_is_live())
 *
 * `event_members` is not consulted. Since 20260809140000 the only two ways to
 * be staff are (a) be a global admin, or (b) hold a CODE session. An
 * email/password member of an event is not staff, whatever `event_members`
 * says — see T1-AUDIT.md.
 *
 * That matters for the suite twice over. It is a real finding about the
 * product, and it means an email/password identity reads zero rows from
 * EVERY event, so "B cannot see A" would have passed vacuously — the
 * identity could not see anything at all, including its own event.
 *
 * So T1 mints code sessions, and every isolation assertion is paired with a
 * POSITIVE CONTROL proving the same session can read its own event. Without
 * the control, "sees nothing" is indistinguishable from "is nobody".
 *
 * SERVICE ROLE IS SETUP ONLY. It issues the access codes. Every assertion
 * runs on the minted session, except the immutability tests, where the
 * guarantee under test is specifically "not even service role can do this".
 */

import { createHash, randomUUID } from 'node:crypto'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export interface T1Env {
  supabaseUrl: string
  serviceKey: string
  anonKey: string
  eventA: string
  eventB: string
}

export interface Identity {
  label: string
  role: 'team' | 'client'
  eventId: string
  /** A client carrying a real code-auth JWT. RLS sees the real claims. */
  client: SupabaseClient
  token: string
  /** Set once a staff member is bound. Writes are impossible without one. */
  staffMemberId: string | null
}

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function loadT1Env(): T1Env | null {
  const supabaseUrl = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '')
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  const eventA = process.env.T1_EVENT_A ?? ''
  const eventB = process.env.T1_EVENT_B ?? ''
  if (!supabaseUrl || !serviceKey || !anonKey || !eventA || !eventB) return null
  return { supabaseUrl, serviceKey, anonKey, eventA, eventB }
}

export function admin(env: T1Env): SupabaseClient {
  return createClient(env.supabaseUrl, env.serviceKey, { auth: { persistSession: false } })
}

function randomBody(): string {
  let out = ''
  for (let i = 0; i < 6; i += 1) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  return out
}

/** Must match verify-access-code exactly: sha256 hex of the normalized code. */
function hashCode(full: string): string {
  return createHash('sha256').update(full).digest('hex')
}

/**
 * Issue a fresh access code for an event and exchange it for a real session.
 *
 * The code is inserted directly rather than through `rotate_access_code`
 * because rotation retires the LIVE code — and retiring the code the event
 * staff are holding, on the production project, to run a test, is not an
 * acceptable side effect. A partial unique index enforces one live code per
 * (event, role), so any existing live code is retired only if one exists for a
 * role this suite needs, and it is restored in `releaseIdentities()`.
 */
export async function mintCodeSession(
  env: T1Env,
  opts: {
    label: string
    eventId: string
    role: 'team' | 'client'
    /**
     * Bind a staff identity, as the real "Who are you?" step does.
     *
     * NOT optional for a session that needs to write. The insert policies added
     * in 20260807000501 require `app.has_staff_identity(event_id)`, so an
     * unbound team session reads fine and every write fails 42501. Skipping
     * this is what made T1's first positive control fail against a perfectly
     * healthy database.
     */
    bindStaff?: boolean
  },
): Promise<Identity & { codeRowId: string; retired: string | null }> {
  const sf = admin(env)
  const prefix = opts.role === 'team' ? 'E' : 'C'
  const body = randomBody()
  const full = `${prefix}${body}` // normalized form: no hyphen, uppercase
  const display = `${prefix}-${body}`

  // Park any existing live code for this (event, role) so the partial unique
  // index accepts ours. Restored afterwards.
  const { data: existing } = await sf
    .from('event_access_codes')
    .select('id')
    .eq('event_id', opts.eventId)
    .eq('role', opts.role)
    .is('revoked_at', null)
    .is('rotated_at', null)
    .maybeSingle()

  if (existing) {
    await sf
      .from('event_access_codes')
      .update({ rotated_at: new Date().toISOString() })
      .eq('id', existing.id)
  }

  const { data: inserted, error: insErr } = await sf
    .from('event_access_codes')
    .insert({
      event_id: opts.eventId,
      role: opts.role,
      code_hash: hashCode(full),
      code_prefix: prefix,
      last_four: body.slice(-4),
    })
    .select('id')
    .single()

  if (insErr || !inserted) {
    if (existing) {
      await sf.from('event_access_codes').update({ rotated_at: null }).eq('id', existing.id)
    }
    throw new Error(`could not issue a ${opts.role} code for ${opts.eventId}: ${insErr?.message}`)
  }

  // Exchange it through the REAL edge function, so the JWT carries exactly the
  // claims production issues — not claims this test invented.
  const res = await fetch(`${env.supabaseUrl}/functions/v1/verify-access-code`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.anonKey}`,
      apikey: env.anonKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code: display, device_id: `t1-${randomUUID()}` }),
  })

  const payload = (await res.json()) as { token?: string; access_token?: string; error?: string }
  const token = payload.token ?? payload.access_token
  if (!res.ok || !token) {
    throw new Error(
      `verify-access-code refused the freshly issued ${opts.role} code ` +
        `(HTTP ${res.status}: ${payload.error ?? JSON.stringify(payload).slice(0, 200)})`,
    )
  }

  // The client is built AFTER binding, from whichever token ends up active —
  // building it here as well left a stale unbound client that nothing used.
  let activeToken = token
  let staffMemberId: string | null = null

  if (opts.bindStaff) {
    const { data: staff } = await sf
      .from('staff_members')
      .select('id')
      .eq('event_id', opts.eventId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()

    if (!staff) {
      throw new Error(
        `${opts.label}: event ${opts.eventId} has no active staff_members row, so no team ` +
          'session can be bound and no write can be attributed. Add one before running T1.',
      )
    }

    // Re-mint through the REAL function: binding re-signs the JWT with the
    // staff_member_id claim, it does not set a cookie.
    const bindRes = await fetch(`${env.supabaseUrl}/functions/v1/bind-staff-member`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.anonKey}`,
        apikey: env.anonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token, staff_member_id: staff.id }),
    })
    const bound = (await bindRes.json()) as { access_token?: string; error?: string }
    if (!bindRes.ok || !bound.access_token) {
      throw new Error(
        `${opts.label}: bind-staff-member refused (HTTP ${bindRes.status}: ${bound.error ?? 'no token'})`,
      )
    }
    activeToken = bound.access_token
    staffMemberId = staff.id
  }

  const boundClient = createClient(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${activeToken}` } },
  })

  return {
    label: opts.label,
    role: opts.role,
    eventId: opts.eventId,
    client: boundClient,
    token: activeToken,
    staffMemberId,
    codeRowId: inserted.id,
    retired: existing?.id ?? null,
  }
}

/**
 * Revoke the codes this suite issued and un-retire whatever it displaced.
 *
 * Not optional housekeeping: leaving a live test code on the production event
 * is a working password to the guest list.
 */
export async function releaseIdentities(
  env: T1Env,
  issued: { codeRowId: string; retired: string | null }[],
): Promise<void> {
  const sf = admin(env)
  for (const item of issued) {
    await sf
      .from('event_access_codes')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', item.codeRowId)
  }
  // Restore afterwards, so the partial unique index never sees two live rows.
  for (const item of issued) {
    if (item.retired) {
      await sf.from('event_access_codes').update({ rotated_at: null }).eq('id', item.retired)
    }
  }
}

/**
 * Fail loudly if the session under test is not a real, non-admin code session.
 *
 * Closes the exact hole this suite exists to fix: a helper quietly swapped to
 * the service key turns every "denied" assertion into a passing lie.
 */
export function assertCodeSession(identity: Identity): void {
  const [, payloadPart] = identity.token.split('.')
  if (!payloadPart) throw new Error(`${identity.label} has no decodable JWT`)
  const claims = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as {
    role?: string
    event_id?: string
    app_role?: string
  }

  if (claims.role === 'service_role') {
    throw new Error(`${identity.label} is a SERVICE ROLE session — it cannot test isolation`)
  }
  if (claims.event_id !== identity.eventId) {
    throw new Error(
      `${identity.label} carries event_id ${claims.event_id}, expected ${identity.eventId}`,
    )
  }
  const expected = identity.role === 'team' ? 'team' : 'client'
  if (claims.app_role !== expected) {
    throw new Error(`${identity.label} carries app_role ${claims.app_role}, expected ${expected}`)
  }
}
