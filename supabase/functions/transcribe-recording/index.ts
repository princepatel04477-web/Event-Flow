// Type definitions for the Supabase edge runtime. Without this the Deno
// namespace is unknown and every Deno.serve / Deno.env.get reports an error in
// the dashboard editor (and in any Deno LSP). Runtime behaviour is unchanged —
// it is types only.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

import { createClient } from 'npm:@supabase/supabase-js@2'

/**
 * transcribe-recording — STT for one call recording, via Sarvam.
 *
 * This is the STT step ONLY. Capture (M7) writes the call_recordings row;
 * extraction (Claude → rsvp_extractions) is a separate function. This one
 * reads audio and writes a transcript. Nothing else.
 *
 * TRIGGER: Database Webhook on `insert into call_recordings` (see migration
 * 20260810120000_transcribe_webhook.sql). Chosen over a direct invoke from
 * the app because there is no app-side producer today — the upload path is
 * unwired — and because the phone is the least reliable component in the
 * system. A client-driven invoke silently never fires when the handset drops
 * mid-upload, and the recording then sits with no transcript and nothing to
 * indicate one was ever expected. A DB trigger fires from the same
 * transaction that commits the row, so "a recording exists" and "a transcript
 * was attempted" cannot diverge. Documented in CLAUDE.md §9.
 *
 * IDEMPOTENCY: `transcripts_recording_id_uq` (unique on recording_id) means a
 * duplicate webhook delivery cannot create a second transcript. A redelivery
 * lands on the existing row: 'complete' is left alone (never re-bill STT),
 * 'pending'/'processing'/'failed' are picked up and retried.
 *
 * COST: ~₹45/hour. Re-running STT costs ~₹0.75/call; re-running extraction
 * costs ~₹0.03. That asymmetry is why `raw_response` stores the ENTIRE Sarvam
 * payload untrimmed — so the extraction prompt can be iterated forever without
 * ever paying for STT twice.
 *
 * SECURITY (do not weaken):
 *   * SARVAM_API_KEY lives in Edge Function secrets only. The APK is a zip
 *     file; anything in the client bundle is public.
 *   * This function's ONLY write targets are `transcripts` rows. It holds the
 *     service role key, so the restraint is enforced by review + the RLS test
 *     in tests/l2_transcribe.sql, not by the grant system.
 *   * Callers must present the shared secret. Without it this endpoint would
 *     let anyone burn ₹0.75 per request.
 */

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const sarvamApiKey = Deno.env.get('SARVAM_API_KEY')!
const webhookSecret = Deno.env.get('TRANSCRIBE_WEBHOOK_SECRET')!

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
})

// ---------------------------------------------------------------------------
// Tunables. These are the settings that matter more than the code.
// ---------------------------------------------------------------------------

/** Below this, a call is a misdial. Skipping saves ₹0.75 a pop. */
const MIN_DURATION_SEC = 10

/** Batch STT is slower than realtime. */
const SARVAM_TIMEOUT_MS = 180_000

/** 3 retries on 5xx/timeout. NEVER on 4xx — a 4xx is our bug, not theirs. */
const MAX_ATTEMPTS = 3
const BACKOFF_BASE_MS = 2_000

const RUPEES_PER_HOUR = 45
/** Ceiling is ~40 cumulative hours. Past this, something is looping. */
const COST_ALERT_HOURS = 50

/** Signed URL lifetime — long enough for a 180s batch call, no longer. */
const SIGNED_URL_TTL_SEC = 600

// ---------------------------------------------------------------------------
// Sarvam
// ---------------------------------------------------------------------------

/**
 * Sarvam Saaras v3, batch, with diarization.
 *
 * Config rationale (these are deliberate, do not "simplify" them):
 *   * language_code 'unknown' = AUTO-DETECT. Do NOT pin hi-IN. These calls
 *     switch to English mid-sentence and the switches land exactly on dates,
 *     flight numbers and "confirm" — the tokens extraction depends on.
 *   * with_diarization: this is what the extra ₹15/hr over plain STT buys.
 *     Extraction is materially worse when it cannot tell who said a number.
 *   * with_timestamps: the review screen scrubs audio to an evidence span.
 *     Without word timings that interaction cannot exist.
 *   * output codemix (Devanagari for Hindi, Latin for English), NOT translate.
 *     Translating to English destroys number and date precision, which is the
 *     entire point of transcribing the call.
 *
 * VERIFY BEFORE FIRST LIVE RUN: endpoint path and response field names are
 * written against Sarvam's documented batch STT shape. If Sarvam has moved,
 * this is the ONLY function that changes — normalise() consumes the parsed
 * result, not the wire format.
 */
const SARVAM_ENDPOINT = 'https://api.sarvam.ai/speech-to-text'
const SARVAM_MODEL = 'saaras:v3'

type SarvamCallResult =
  | { kind: 'ok'; payload: unknown }
  | { kind: 'client_error'; status: number; detail: string }
  | { kind: 'server_error'; status: number; detail: string }
  | { kind: 'timeout'; detail: string }

async function callSarvamOnce(audio: Blob, filename: string): Promise<SarvamCallResult> {
  const form = new FormData()
  form.append('file', audio, filename)
  form.append('model', SARVAM_MODEL)
  form.append('language_code', 'unknown') // auto-detect; see rationale above
  form.append('with_diarization', 'true')
  form.append('with_timestamps', 'true')
  form.append('output_script', 'codemix')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SARVAM_TIMEOUT_MS)

  try {
    const res = await fetch(SARVAM_ENDPOINT, {
      method: 'POST',
      headers: { 'api-subscription-key': sarvamApiKey },
      body: form,
      signal: controller.signal,
    })

    const text = await res.text()

    if (res.ok) {
      try {
        return { kind: 'ok', payload: JSON.parse(text) }
      } catch {
        // A 200 we cannot parse is not retryable — retrying returns the same
        // unparseable body and bills us again.
        return { kind: 'client_error', status: res.status, detail: `Unparseable success body: ${text.slice(0, 500)}` }
      }
    }

    if (res.status >= 500) {
      return { kind: 'server_error', status: res.status, detail: text.slice(0, 500) }
    }
    return { kind: 'client_error', status: res.status, detail: text.slice(0, 500) }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    // AbortError = our own timeout. Treat as retryable.
    return { kind: 'timeout', detail }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Retry 3x with exponential backoff on 5xx and timeouts. NEVER on 4xx —
 * a 401/413/422 will fail identically every time and each attempt is billable.
 */
async function callSarvamWithRetry(
  audio: Blob,
  filename: string,
): Promise<{ payload: unknown } | { error: string }> {
  let last = ''

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await callSarvamOnce(audio, filename)

    if (res.kind === 'ok') return { payload: res.payload }

    if (res.kind === 'client_error') {
      // Terminal by design.
      return { error: `Sarvam ${res.status} (not retried): ${res.detail}` }
    }

    last =
      res.kind === 'timeout'
        ? `timeout after ${SARVAM_TIMEOUT_MS}ms: ${res.detail}`
        : `Sarvam ${res.status}: ${res.detail}`

    console.warn(`transcribe-recording: attempt ${attempt}/${MAX_ATTEMPTS} failed — ${last}`)

    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, BACKOFF_BASE_MS * 2 ** (attempt - 1)))
    }
  }

  return { error: `Exhausted ${MAX_ATTEMPTS} attempts. Last: ${last}` }
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

type Segment = {
  speaker: 'staff' | 'guest'
  start_ms: number
  end_ms: number
  text: string
  /** Sarvam's own label, kept so a correction in review is possible. */
  raw_speaker: string | null
}

type Normalised = {
  fullText: string
  segments: Segment[]
  detectedLanguages: string[]
  /** Explicit, so review can flip it — see speakerAssumption below. */
  speakerAssumption: Record<string, unknown>
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

/** Seconds-or-milliseconds → ms. Sarvam returns seconds; be tolerant. */
function toMs(v: unknown): number {
  const n = asNumber(v)
  if (n === null) return 0
  // A 3-minute call never has a start beyond ~180s, so a value that large is
  // already in ms.
  return n > 10_000 ? Math.round(n) : Math.round(n * 1000)
}

/**
 * Map Sarvam's speaker labels to staff|guest by assuming the FIRST speaker is
 * staff — they placed the call, so they speak first ("Hello, Nuvent se bol
 * raha hoon"). This is an assumption, not a fact: if the guest answers with
 * "Haan bolo" first, it inverts. It is recorded explicitly in segment
 * metadata so the review screen can offer a one-tap swap rather than silently
 * mis-attributing every quote in the call.
 */
function normalise(payload: unknown): Normalised {
  const root = (payload ?? {}) as Record<string, unknown>

  const diarized =
    (root.diarized_transcript as Record<string, unknown> | undefined) ?? undefined
  const entriesRaw =
    (diarized?.entries as unknown[] | undefined) ??
    (root.segments as unknown[] | undefined) ??
    (root.entries as unknown[] | undefined) ??
    []

  const entries = Array.isArray(entriesRaw) ? entriesRaw : []

  // Order matters: "first speaker" must mean first in time, not first in the
  // array, in case the provider ever returns them grouped by speaker.
  const parsed = entries
    .map((e) => {
      const o = (e ?? {}) as Record<string, unknown>
      const rawSpeaker =
        typeof o.speaker_id === 'string'
          ? o.speaker_id
          : typeof o.speaker === 'string'
            ? o.speaker
            : null
      return {
        rawSpeaker,
        start_ms: toMs(o.start_time_seconds ?? o.start_ms ?? o.start),
        end_ms: toMs(o.end_time_seconds ?? o.end_ms ?? o.end),
        text: typeof o.transcript === 'string' ? o.transcript : typeof o.text === 'string' ? o.text : '',
      }
    })
    .sort((a, b) => a.start_ms - b.start_ms)

  const firstSpeaker = parsed.find((p) => p.rawSpeaker !== null)?.rawSpeaker ?? null

  const segments: Segment[] = parsed.map((p) => ({
    speaker: p.rawSpeaker !== null && p.rawSpeaker === firstSpeaker ? 'staff' : 'guest',
    start_ms: p.start_ms,
    end_ms: p.end_ms,
    text: p.text,
    raw_speaker: p.rawSpeaker,
  }))

  // Prefer the provider's own full transcript; fall back to joining segments.
  const providerFull =
    typeof root.transcript === 'string'
      ? root.transcript
      : typeof root.full_text === 'string'
        ? root.full_text
        : null

  const fullText = providerFull ?? segments.map((s) => s.text).join(' ').trim()

  const langRaw = root.language_code ?? root.detected_language_code ?? root.languages
  const detectedLanguages = Array.isArray(langRaw)
    ? langRaw.filter((l): l is string => typeof l === 'string')
    : typeof langRaw === 'string'
      ? [langRaw]
      : []

  return {
    fullText,
    segments,
    detectedLanguages,
    speakerAssumption: {
      rule: 'first_speaker_is_staff',
      reason: 'Staff placed the call, so they normally speak first.',
      first_raw_speaker: firstSpeaker,
      confident: false,
      correctable_in_review: true,
    },
  }
}

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

/**
 * Cumulative STT hours, DERIVED — never a stored counter. CLAUDE.md §5.4:
 * "Attempt count is count(*), never a stored counter — stored counters drift."
 * The same reasoning applies here, and more so: a stored counter that drifts
 * upward would silence the alert exactly when a retry loop is burning money.
 */
async function cumulativeHours(eventId: string): Promise<number | null> {
  const { data, error } = await db
    .from('transcripts')
    .select('recording_id, call_recordings!inner(duration_sec)')
    .eq('event_id', eventId)
    .eq('status', 'complete')

  if (error) {
    console.error('transcribe-recording: cost rollup failed:', error.message)
    return null
  }

  const totalSec = (data ?? []).reduce((sum, row) => {
    const rec = (row as Record<string, unknown>).call_recordings as { duration_sec?: number } | null
    return sum + (rec?.duration_sec ?? 0)
  }, 0)

  return totalSec / 3600
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/** Accepts both a Database Webhook envelope and a direct `{recording_id}`. */
function extractRecordingId(body: unknown): string | null {
  const b = (body ?? {}) as Record<string, unknown>
  if (typeof b.recording_id === 'string' && b.recording_id) return b.recording_id
  const record = b.record as Record<string, unknown> | undefined
  if (record && typeof record.id === 'string' && record.id) return record.id
  return null
}

async function markFailed(transcriptId: string | null, reason: string) {
  if (!transcriptId) return
  const { error } = await db
    .from('transcripts')
    .update({ status: 'failed', error_text: reason })
    .eq('id', transcriptId)
  if (error) console.error('transcribe-recording: could not mark failed:', error.message)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-secret',
      },
    })
  }

  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  // Shared-secret gate. Without this, anyone who learns the URL can bill us
  // ₹0.75 per request and fill the table with junk.
  if (req.headers.get('x-webhook-secret') !== webhookSecret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }

  const recordingId = extractRecordingId(body)
  if (!recordingId) {
    return Response.json({ error: 'recording_id required' }, { status: 400 })
  }

  // 1. Load the recording. event_id is inherited from here, never from the
  //    caller — a caller-supplied event_id would be a tenancy hole.
  const { data: rec, error: recErr } = await db
    .from('call_recordings')
    .select('id, event_id, group_id, storage_bucket, storage_path, duration_sec, mime_type, consent_given')
    .eq('id', recordingId)
    .maybeSingle()

  if (recErr || !rec) {
    return Response.json({ error: 'Recording not found' }, { status: 404 })
  }

  // 1b. CONSENT GATE (§6.1) — the application-layer defence in depth.
  //  Non-consented audio must never reach the STT provider: transcribing a
  //  call the guest did not agree to is a privacy breach that costs real
  //  money and cannot be undone. consent_given defaults to false and is set
  //  true only when the guest was read the disclosure script and agreed.
  //  This check happens BEFORE any spend, and before any transcript row is
  //  claimed — a refused recording stays silent, with no ₹0.75 burned.
  if (rec.consent_given !== true) {
    return Response.json(
      {
        ok: false,
        skipped: 'consent_missing',
        recording_id: recordingId,
        error: 'Recording has no consent on file — refusing to transcribe.',
      },
      { status: 200 },
    )
  }

  // 2. Claim the transcript row FIRST, before any spend. A crash after this
  //    point leaves a visible 'pending'/'processing' row, not silence.
  //    `text` is NOT NULL (legacy column, predates full_text) so it takes an
  //    empty string until the real transcript lands.
  const { data: existing } = await db
    .from('transcripts')
    .select('id, status')
    .eq('recording_id', recordingId)
    .maybeSingle()

  if (existing?.status === 'complete') {
    // Redelivery of a webhook for work already paid for. Never re-bill.
    return Response.json({ ok: true, skipped: 'already_complete', transcript_id: existing.id })
  }

  let transcriptId = existing?.id ?? null

  if (!transcriptId) {
    const { data: inserted, error: insErr } = await db
      .from('transcripts')
      .insert({
        event_id: rec.event_id,
        recording_id: rec.id,
        text: '',
        status: 'pending',
        provider: 'sarvam',
        model: SARVAM_MODEL,
      })
      .select('id')
      .single()

    if (insErr || !inserted) {
      return Response.json({ error: `Could not create transcript: ${insErr?.message}` }, { status: 500 })
    }
    transcriptId = inserted.id
  }

  // 3. Too short — a misdial. Skip entirely, no API call, no spend.
  //    Checked AFTER the row exists so the skip is auditable rather than
  //    leaving a recording with no transcript and no explanation.
  if (rec.duration_sec !== null && rec.duration_sec < MIN_DURATION_SEC) {
    await markFailed(transcriptId, 'too_short')
    return Response.json({
      ok: true,
      skipped: 'too_short',
      transcript_id: transcriptId,
      duration_sec: rec.duration_sec,
    })
  }

  await db.from('transcripts').update({ status: 'processing' }).eq('id', transcriptId)

  // 4. Signed URL → download server-side. Audio never streams through the
  //    client; the bucket is private and stays private.
  const { data: signed, error: signErr } = await db.storage
    .from(rec.storage_bucket)
    .createSignedUrl(rec.storage_path, SIGNED_URL_TTL_SEC)

  if (signErr || !signed?.signedUrl) {
    await markFailed(transcriptId, `Could not sign storage URL: ${signErr?.message ?? 'unknown'}`)
    return Response.json({ error: 'Could not access audio' }, { status: 500 })
  }

  let audio: Blob
  try {
    const audioRes = await fetch(signed.signedUrl)
    if (!audioRes.ok) throw new Error(`storage returned ${audioRes.status}`)
    audio = await audioRes.blob()
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    await markFailed(transcriptId, `Audio download failed: ${detail}`)
    return Response.json({ error: 'Could not download audio' }, { status: 500 })
  }

  // 5. Sarvam.
  const filename = rec.storage_path.split('/').pop() ?? 'call.m4a'
  const result = await callSarvamWithRetry(audio, filename)

  if ('error' in result) {
    // Terminal. The call STILL reaches the review queue — a staff member is
    // never blocked by this pipeline; they enter the RSVP by hand.
    await markFailed(transcriptId, result.error)
    return Response.json({ ok: false, status: 'failed', transcript_id: transcriptId, error: result.error })
  }

  // 6. Normalise. raw_response keeps the ENTIRE payload — including fields we
  //    do not read today. Re-running extraction is ₹0.03; re-running STT is
  //    ₹0.75. Never discard anything that would force the expensive path.
  const norm = normalise(result.payload)

  const { error: updErr } = await db
    .from('transcripts')
    .update({
      status: 'complete',
      raw_response: result.payload as Record<string, unknown>,
      full_text: norm.fullText,
      text: norm.fullText, // legacy NOT NULL column, kept in sync
      segments: { segments: norm.segments, assumption: norm.speakerAssumption },
      detected_languages: norm.detectedLanguages,
      error_text: null,
    })
    .eq('id', transcriptId)

  if (updErr) {
    // The spend already happened. Losing the payload here would mean paying
    // again, so surface loudly.
    console.error('transcribe-recording: PAID BUT UNSAVED —', updErr.message)
    await markFailed(transcriptId, `Transcribed but could not save: ${updErr.message}`)
    return Response.json({ error: 'Could not save transcript' }, { status: 500 })
  }

  // 7. Cost. Derived, not stored.
  const thisCallHours = (rec.duration_sec ?? 0) / 3600
  const thisCallRupees = thisCallHours * RUPEES_PER_HOUR
  const totalHours = await cumulativeHours(rec.event_id)

  console.log(
    `transcribe-recording: ${recordingId} ok — ${rec.duration_sec ?? '?'}s, ` +
      `₹${thisCallRupees.toFixed(2)}, cumulative ${totalHours?.toFixed(2) ?? '?'}h`,
  )

  if (totalHours !== null && totalHours > COST_ALERT_HOURS) {
    // Ceiling is ~40h. Past 50 something is looping and billing us for it.
    console.error(
      `transcribe-recording: COST ALERT — ${totalHours.toFixed(1)}h cumulative STT ` +
        `for event ${rec.event_id}, over the ${COST_ALERT_HOURS}h threshold ` +
        `(₹${(totalHours * RUPEES_PER_HOUR).toFixed(0)}). Expected ceiling is ~40h.`,
    )
  }

  return Response.json({
    ok: true,
    status: 'complete',
    transcript_id: transcriptId,
    segments: norm.segments.length,
    detected_languages: norm.detectedLanguages,
    cost_rupees: Number(thisCallRupees.toFixed(2)),
    cumulative_hours: totalHours === null ? null : Number(totalHours.toFixed(2)),
    cost_alert: totalHours !== null && totalHours > COST_ALERT_HOURS,
  })
})
