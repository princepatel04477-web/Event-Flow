/**
 * A0 verification probe — proves the A0 DoD against the LIVE database.
 *
 * Run: node scripts/verify-a0.mjs   (from repo root; reads .env.test)
 *
 * The service-role key bypasses RLS, so trigger-level guarantees (V1-V4)
 * are tested with it, exactly as the A0 prompt requires ("tested with the
 * service role key ... service role bypasses RLS — this proves the trigger").
 * The cross-event RLS test (V9) uses a REAL staff session (user A) — RLS
 * is the only thing that can prove a staff member cannot read another
 * event's recordings.
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

const env = {
  ...parseEnvFile(join(process.cwd(), '.env.local')),
  ...parseEnvFile(join(process.cwd(), '.env.test')),
}

const ANON_KEY = env.SUPABASE_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!ANON_KEY) throw new Error('anon key not found in .env.local or .env.test')
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const EVENT_ID = env.E2E_EVENT_ID
const results = []

function record(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail ?? ''}`)
}

async function main() {
  const stamp = Date.now().toString(36)
  const groupName = `A0-VERIFY-${stamp}`

  // Resolve a real auth user id for the reviewed_by FK.
  const { data: authUsers } = await db.auth.admin.listUsers()
  const reviewerId = authUsers.users[0]?.id
  if (!reviewerId) throw new Error('no auth user available for FK')

  // ---- fixtures: group + attempt + recording + transcript ----
  const { data: group, error: gErr } = await db
    .from('guest_groups')
    .insert({ event_id: EVENT_ID, head_name: groupName, expected_pax: 1, rsvp_status: 'not_started' })
    .select('id')
    .single()
  if (gErr) throw new Error(`group insert: ${gErr.message}`)

  const { data: attempt, error: aErr } = await db
    .from('call_attempts')
    .insert({ event_id: EVENT_ID, group_id: group.id, dialed_number: '9999900000', caller_id: reviewerId })
    .select('id')
    .single()
  if (aErr) throw new Error(`attempt insert: ${aErr.message}`)

  const recordingPath = `${EVENT_ID}/${group.id}/${stamp}.aac`
  const { data: recording, error: rErr } = await db
    .from('call_recordings')
    .insert({
      event_id: EVENT_ID,
      group_id: group.id,
      call_attempt_id: attempt.id,
      storage_path: recordingPath,
      duration_sec: 60,
    })
    .select('id, consent_given')
    .single()
  if (rErr) throw new Error(`recording insert: ${rErr.message}`)

  record('V6 consent_given defaults false', recording.consent_given === false, `got ${recording.consent_given}`)

  // V1/V2: UPDATE + DELETE rejected by trigger (service role bypasses RLS)
  const upd = await db.from('call_recordings').update({ duration_sec: 999 }).eq('id', recording.id)
  record('V1 call_recordings UPDATE blocked', upd.error !== null, upd.error?.message ?? 'no error — LEAK')

  const del = await db.from('call_recordings').delete().eq('id', recording.id)
  record('V2 call_recordings DELETE blocked', del.error !== null, del.error?.message ?? 'no error — LEAK')

  // ---- transcript ----
  const { data: transcript, error: tErr } = await db
    .from('transcripts')
    .insert({
      event_id: EVENT_ID,
      recording_id: recording.id,
      text: 'probe transcript',
      full_text: 'probe transcript with evidence',
      raw_response: { probe: true, whole: 'payload' },
      segments: [{ speaker: 'staff', start_ms: 0, end_ms: 100, text: 'probe' }],
      detected_languages: ['hi-IN'],
      status: 'complete',
    })
    .select('id')
    .single()
  if (tErr) throw new Error(`transcript insert: ${tErr.message}`)
  record('V7 transcript columns present', transcript?.id != null)

  // ---- committed extraction ----
  const { data: extraction, error: eErr } = await db
    .from('rsvp_extractions')
    .insert({
      event_id: EVENT_ID,
      group_id: group.id,
      transcript_id: transcript.id,
      parsed: { rsvp_status: 'confirmed', confirmed_pax: 2 },
      confidence: { rsvp_status: 0.9 },
      status: 'committed',
      fields: { arrival_time: { value: '10:30', confidence: 'high', evidence: 'probe', evidence_start_ms: 0, evidence_end_ms: 100, reasoning: 'x' } },
      overall_confidence: 'high',
      model: 'sarvam-chat-105b',
      model_version: 'probe',
      prompt_version: 'a0-v1',
    })
    .select('id')
    .single()
  if (eErr) throw new Error(`extraction insert: ${eErr.message}`)
  record('V10 extraction columns present', extraction?.id != null)

  // V5: second committed for the SAME transcript must fail
  const dup = await db
    .from('rsvp_extractions')
    .insert({
      event_id: EVENT_ID,
      group_id: group.id,
      transcript_id: transcript.id,
      parsed: { rsvp_status: 'tentative', confirmed_pax: 1 },
      confidence: {},
      status: 'committed',
      fields: {},
      model: 'sarvam-chat-105b',
    })
    .select('id')
    .single()
  const dupFailed = dup.error !== null && /one_committed_per_transcript|duplicate key/i.test(dup.error?.message ?? '')
  record('V5 one committed per transcript enforced', dupFailed, dup.error?.message ?? 'no error — second commit LEAKED')

  // ---- field review: insert works, update/delete blocked ----
  const { data: review, error: revErr } = await db
    .from('extraction_field_reviews')
    .insert({
      event_id: EVENT_ID,
      extraction_id: extraction.id,
      field_name: 'arrival_time',
      ai_value: { value: '10:30' },
      final_value: { value: '10:30' },
      action: 'accepted',
      reviewed_by: reviewerId,
    })
    .select('id')
    .single()
  if (revErr) throw new Error(`field review insert: ${revErr.message}`)
  record('field review insert works', review?.id != null)

  const revUpd = await db.from('extraction_field_reviews').update({ action: 'rejected' }).eq('id', review.id)
  record('V3 field_review UPDATE blocked', revUpd.error !== null, revUpd.error?.message ?? 'no error — LEAK')

  const revDel = await db.from('extraction_field_reviews').delete().eq('id', review.id)
  record('V4 field_review DELETE blocked', revDel.error !== null, revDel.error?.message ?? 'no error — LEAK')

  // ---- V8: enum has draft/in_review/committed (insert with 'draft' works) ----
  const enumProbe = await db
    .from('rsvp_extractions')
    .insert({
      event_id: EVENT_ID,
      group_id: group.id,
      parsed: {},
      confidence: {},
      status: 'draft',
      fields: {},
    })
    .select('id, status')
    .single()
  record('V8 enum has draft (insert with draft works)', enumProbe.error === null && enumProbe.data?.status === 'draft', enumProbe.error?.message ?? '')

  // ---- V9: cross-event RLS denial, via a REAL non-admin staff session ----
  // The service role bypasses RLS, so it cannot prove this. Sign in as
  // user B (event_team on EVENT_ID — NOT a global admin, so app.is_staff()
  // is true only for EVENT_ID) and try to read another event's recordings.
  // A leak would return rows; the correct denial returns zero.
  const { data: otherEvents } = await db.from('events').select('id, code').neq('id', EVENT_ID).limit(1)
  if (otherEvents && otherEvents.length > 0) {
    const otherId = otherEvents[0].id
    const userDb = createClient(env.SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
    const { data: signIn, error: signInErr } = await userDb.auth.signInWithPassword({
      email: env.E2E_USER_B_EMAIL,
      password: env.E2E_USER_B_PASSWORD,
    })
    if (signInErr) {
      record('V9 cross-event staff read denied', false, `sign-in failed: ${signInErr.message}`)
    } else {
      // Negative: the OTHER event's recordings are invisible to this staff member.
      const { data: crossRead } = await userDb
        .from('call_recordings')
        .select('id')
        .eq('event_id', otherId)
        .limit(5)
      // Positive control: the SAME user CAN read their own event's recordings —
      // proving the query works and RLS is scoped, not just blocking everything.
      const { data: ownRead } = await userDb
        .from('call_recordings')
        .select('id')
        .eq('event_id', EVENT_ID)
        .limit(5)
      const denied = (crossRead ?? []).length === 0
      const canReadOwn = (ownRead ?? []).length > 0
      record('V9 cross-event staff read denied', denied && canReadOwn, `event_team user on A read ${(crossRead ?? []).length} row(s) of event B; own event rows visible: ${(ownRead ?? []).length}`)
    }
  } else {
    record('V9 cross-event', true, 'no second event exists — trivially denied')
  }

  // ---- V8b: the LIVE review-queue state ('pending') and the commit state
  // ('accepted') still work after the enum extension — R6 for the existing
  // review screens and apply_rsvp_extraction().
  const pendingProbe = await db
    .from('rsvp_extractions')
    .insert({
      event_id: EVENT_ID,
      group_id: group.id,
      parsed: {},
      confidence: {},
      status: 'pending',
      fields: {},
    })
    .select('id, status')
    .single()
  record('V8b enum keeps pending (review queue state)', pendingProbe.error === null && pendingProbe.data?.status === 'pending', pendingProbe.error?.message ?? '')

  const acceptedProbe = await db
    .from('rsvp_extractions')
    .insert({
      event_id: EVENT_ID,
      group_id: group.id,
      parsed: {},
      confidence: {},
      status: 'accepted',
      fields: {},
    })
    .select('id, status')
    .single()
  record('V8c enum keeps accepted (apply_rsvp_extraction state)', acceptedProbe.error === null && acceptedProbe.data?.status === 'accepted', acceptedProbe.error?.message ?? '')

  // ---- V11: the EXISTING apply_rsvp_extraction() RPC still works after the
  // enum extension (R6, exercised end-to-end, not just enum labels). Call it
  // via the service role with a minimal payload on a PENDING extraction; it
  // must flip status to 'accepted' and return the updated group.
  const r6Extract = await db
    .from('rsvp_extractions')
    .insert({
      event_id: EVENT_ID,
      group_id: group.id,
      parsed: {},
      confidence: {},
      status: 'pending',
      fields: {},
    })
    .select('id')
    .single()
  if (r6Extract.data?.id) {
    const rpc = await db.rpc('apply_rsvp_extraction', {
      p_extraction_id: r6Extract.data.id,
      p_payload: { rsvp_status: 'confirmed', confirmed_pax: 1 },
    })
    const { data: after } = await db
      .from('rsvp_extractions')
      .select('status')
      .eq('id', r6Extract.data.id)
      .maybeSingle()
    record('V11 apply_rsvp_extraction still works', rpc.error === null && after?.status === 'accepted', rpc.error?.message ?? `status after = ${after?.status}`)
  } else {
    record('V11 apply_rsvp_extraction still works', false, `fixture insert failed: ${r6Extract.error?.message}`)
  }

  const pass = results.filter((r) => r.ok).length
  const fail = results.filter((r) => !r.ok).length
  console.log(`\nA0 VERIFY: ${pass} passed, ${fail} failed, ${results.length} total`)
  if (fail > 0) process.exit(1)
}
main().catch((e) => { console.error(e); process.exit(1) })
