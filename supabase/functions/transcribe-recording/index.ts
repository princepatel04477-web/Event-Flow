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
 * 'pending'/'processing'/'failed' are picked up and retried. A 'processing'
 * row whose raw_response holds a started Sarvam job id RESUMES polling that
 * job instead of creating (and paying for) a new one.
 *
 * COST: ~₹45/hour. Re-running STT costs ~₹0.75/call; re-running extraction
 * costs ~₹0.03. That asymmetry is why `raw_response` stores the ENTIRE Sarvam
 * payload untrimmed — so the extraction prompt can be iterated forever without
 * ever paying for STT twice.
 *
 * SECURITY (do not weaken):
 *   * SARVAM_API_KEY lives on the server only (Edge Function secret or Vault,
 *     see Secrets below). The APK is a zip file; anything in the client
 *     bundle is public.
 *   * This function's ONLY write targets are `transcripts` rows. It holds the
 *     service role key, so the restraint is enforced by review + the RLS test
 *     in tests/l2_transcribe.sql, not by the grant system.
 *   * Callers must present the shared secret. Without it this endpoint would
 *     let anyone burn ₹0.75 per request.
 */

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
})

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

/**
 * SARVAM_API_KEY and TRANSCRIBE_WEBHOOK_SECRET come from Supabase Vault
 * through public.pipeline_secret() (migration 20260926093324), which only the
 * service role may execute. Edge Function secrets of the same name are only a
 * fallback when Vault has no value.
 *
 * Vault wins because the database trigger reads its webhook secret from Vault
 * too: one source of truth means the two sides cannot drift. They did — a
 * stale TRANSCRIBE_WEBHOOK_SECRET left in the function's env from August
 * 401'd every call on 2026-09-26 until this order was flipped. Rotating the
 * Sarvam key is one `vault.update_secret` in the SQL Editor. Either way the
 * key lives only on the server — never in the APK, the web bundle, or a log
 * line.
 *
 * Cached per instance for CONFIG_TTL_MS so a rotation takes effect within
 * minutes without a redeploy.
 */
const CONFIG_TTL_MS = 5 * 60_000

let sarvamApiKey = ''
let webhookSecret = ''
let configLoadedAt = 0

async function readSecret(envName: string, vaultName: string): Promise<string | null> {
  const { data, error } = await db.rpc('pipeline_secret', { p_name: vaultName })
  if (error) {
    console.error(`transcribe-recording: could not read ${vaultName} from Vault:`, error.message)
  } else if (typeof data === 'string' && data !== '') {
    return data
  }
  return Deno.env.get(envName) || null
}

async function loadConfig(): Promise<boolean> {
  if (sarvamApiKey && webhookSecret && Date.now() - configLoadedAt < CONFIG_TTL_MS) return true
  const [key, secret] = await Promise.all([
    readSecret('SARVAM_API_KEY', 'sarvam_api_key'),
    readSecret('TRANSCRIBE_WEBHOOK_SECRET', 'transcribe_webhook_secret'),
  ])
  if (!key || !secret) return false
  sarvamApiKey = key
  webhookSecret = secret
  configLoadedAt = Date.now()
  return true
}

// ---------------------------------------------------------------------------
// Tunables. These are the settings that matter more than the code.
// ---------------------------------------------------------------------------

/** Below this, a call is a misdial. Skipping saves ₹0.75 a pop. */
const MIN_DURATION_SEC = 10

/**
 * Sarvam batch jobs run asynchronously. Every HTTP step (create, upload,
 * start, status, download) gets its own timeout; the job itself is waited on
 * by polling, bounded by POLL_DEADLINE_MS below.
 */
const REQUEST_TIMEOUT_MS = 30_000

/** How often to ask Sarvam whether the job has finished. */
const POLL_INTERVAL_MS = 5_000

/**
 * Stop waiting in THIS invocation after this long. The job id is saved on the
 * transcript row before the job starts, so a later invocation (webhook
 * redelivery, backlog retry, manual re-run) resumes polling the SAME job
 * instead of paying for a second one. Kept well under the Edge Function
 * wall-clock limit.
 */
const POLL_DEADLINE_MS = 120_000

/** 3 retries on 5xx/429/timeout. NEVER on other 4xx — those are our bug, not theirs. */
const MAX_ATTEMPTS = 3
const BACKOFF_BASE_MS = 2_000

const RUPEES_PER_HOUR = 45
/** Ceiling is ~40 cumulative hours. Past this, something is looping. */
const COST_ALERT_HOURS = 50

/** Signed URL lifetime — only used to pull the audio into this function. */
const SIGNED_URL_TTL_SEC = 600

// ---------------------------------------------------------------------------
// Sarvam
// ---------------------------------------------------------------------------

/**
 * Sarvam Saaras v3, BATCH job API, with diarization.
 *
 * Why batch and not POST /speech-to-text: the synchronous REST endpoint
 * accepts at most 30 seconds of audio and does not diarize. A real RSVP call
 * is 1–5 minutes and extraction needs to know who said each number, so the
 * REST endpoint fails on exactly the calls that matter. The batch API takes
 * up to 2 hours per file and returns diarized_transcript.entries.
 * (docs.sarvam.ai → Speech-to-Text → "Which API to use", verified 2026-09-26.)
 *
 * Wire flow, taken from Sarvam's official SDK (sarvamai, speech_to_text_job):
 *   1. POST {BASE}                    { job_parameters }         → job_id
 *   2. POST {BASE}/upload-files       { job_id, files: [name] }  → upload_urls[name].file_url
 *   3. PUT  file_url  (x-ms-blob-type: BlockBlob)                → audio bytes
 *   4. POST {BASE}/{job_id}/start
 *   5. GET  {BASE}/{job_id}/status    → job_state Accepted|Pending|Running|Completed|Failed,
 *                                       job_details[].{state, outputs[].file_name, error_message}
 *   6. POST {BASE}/download-files     { job_id, files: [output] } → download_urls[output].file_url
 *   7. GET  file_url                  → the transcript JSON normalise() reads
 * Auth header on Sarvam calls: api-subscription-key. The presigned upload and
 * download URLs take no auth header.
 *
 * Config rationale (these are deliberate, do not "simplify" them):
 *   * language_code 'unknown' = AUTO-DETECT. Do NOT pin hi-IN. These calls
 *     switch to English mid-sentence and the switches land exactly on dates,
 *     flight numbers and "confirm" — the tokens extraction depends on.
 *   * with_diarization + num_speakers 2: one staff member, one guest.
 *     Extraction is materially worse when it cannot tell who said a number.
 *   * with_timestamps: the review screen scrubs audio to an evidence span.
 *     Without timings that interaction cannot exist.
 *   * mode 'codemix' (Devanagari for Hindi, Latin for English), NOT translate.
 *     Translating to English destroys number and date precision, which is the
 *     entire point of transcribing the call.
 */
const SARVAM_BASE = 'https://api.sarvam.ai/speech-to-text/job/v1'
const SARVAM_MODEL = 'saaras:v3'
const SARVAM_MODE = 'codemix'

type HttpFailure = { error: string; terminal: boolean }
type HttpSuccess = { body: unknown }

type HttpAttempt =
  | { kind: 'ok'; body: unknown }
  | { kind: 'client_error'; status: number; detail: string }
  | { kind: 'server_error'; status: number; detail: string }
  | { kind: 'timeout'; detail: string }

async function httpOnce(url: string, init: RequestInit, expectJson: boolean): Promise<HttpAttempt> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    const text = await res.text()

    if (res.ok) {
      if (!expectJson) return { kind: 'ok', body: text }
      try {
        return { kind: 'ok', body: text === '' ? {} : JSON.parse(text) }
      } catch {
        // A 200 we cannot parse is not retryable — retrying returns the same
        // unparseable body.
        return { kind: 'client_error', status: res.status, detail: `Unparseable success body: ${text.slice(0, 500)}` }
      }
    }

    // 429 is back-pressure, not a bad request: waiting and retrying is correct
    // and costs nothing.
    if (res.status >= 500 || res.status === 429) {
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
 * Retry 3x with exponential backoff on 5xx, 429 and timeouts. NEVER on other
 * 4xx — a 401/413/422 fails identically every time.
 */
async function httpWithRetry(
  step: string,
  url: string,
  init: RequestInit,
  expectJson: boolean,
): Promise<HttpSuccess | HttpFailure> {
  let last = ''

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await httpOnce(url, init, expectJson)

    if (res.kind === 'ok') return { body: res.body }

    if (res.kind === 'client_error') {
      return { error: `Sarvam ${step}: ${res.status} (not retried): ${res.detail}`, terminal: true }
    }

    last =
      res.kind === 'timeout'
        ? `timeout after ${REQUEST_TIMEOUT_MS}ms: ${res.detail}`
        : `${res.status}: ${res.detail}`

    console.warn(`transcribe-recording: ${step} attempt ${attempt}/${MAX_ATTEMPTS} failed — ${last}`)

    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, BACKOFF_BASE_MS * 2 ** (attempt - 1)))
    }
  }

  return { error: `Sarvam ${step}: exhausted ${MAX_ATTEMPTS} attempts. Last: ${last}`, terminal: false }
}

function field(obj: unknown, key: string): unknown {
  if (obj === null || typeof obj !== 'object') return undefined
  return (obj as Record<string, unknown>)[key]
}

function stringField(obj: unknown, key: string): string | null {
  const v = field(obj, key)
  return typeof v === 'string' && v !== '' ? v : null
}

/** Reads `<container>[name].file_url` from an upload/download-links response. */
function signedFileUrl(body: unknown, container: 'upload_urls' | 'download_urls', name: string): string | null {
  return stringField(field(field(body, container), name), 'file_url')
}

function sarvamPost(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'api-subscription-key': sarvamApiKey, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

async function sarvamCreateJob(): Promise<{ jobId: string } | HttpFailure> {
  const res = await httpWithRetry(
    'create job',
    SARVAM_BASE,
    sarvamPost({
      job_parameters: {
        model: SARVAM_MODEL,
        mode: SARVAM_MODE,
        language_code: 'unknown', // auto-detect; see rationale above
        with_timestamps: true,
        with_diarization: true,
        num_speakers: 2,
      },
    }),
    true,
  )
  if ('error' in res) return res

  const jobId = stringField(res.body, 'job_id')
  if (!jobId) {
    return { error: `Sarvam create job: no job_id in ${JSON.stringify(res.body).slice(0, 300)}`, terminal: true }
  }
  return { jobId }
}

async function sarvamUploadAndStart(
  jobId: string,
  audio: Blob,
  filename: string,
  mimeType: string,
): Promise<{ ok: true } | HttpFailure> {
  const links = await httpWithRetry('upload links', `${SARVAM_BASE}/upload-files`, sarvamPost({ job_id: jobId, files: [filename] }), true)
  if ('error' in links) return links

  const uploadUrl = signedFileUrl(links.body, 'upload_urls', filename)
  if (!uploadUrl) {
    return { error: `Sarvam upload links: no upload URL for ${filename}`, terminal: true }
  }

  const put = await httpWithRetry(
    'upload',
    uploadUrl,
    { method: 'PUT', headers: { 'x-ms-blob-type': 'BlockBlob', 'content-type': mimeType }, body: audio },
    false,
  )
  if ('error' in put) return put

  const start = await httpWithRetry(
    'start job',
    `${SARVAM_BASE}/${encodeURIComponent(jobId)}/start`,
    { method: 'POST', headers: { 'api-subscription-key': sarvamApiKey } },
    true,
  )
  if ('error' in start) return start

  return { ok: true }
}

type PollOutcome =
  | { kind: 'done'; outputFile: string }
  | { kind: 'failed'; error: string }
  | { kind: 'still_running'; state: string; detail: string }

/**
 * Waits for the job, bounded by POLL_DEADLINE_MS. A status call that keeps
 * failing transiently is NOT a failed job — the job may well be fine — so it
 * reports still_running and leaves the job id in place for a later resume.
 */
async function sarvamPoll(jobId: string): Promise<PollOutcome> {
  const deadline = Date.now() + POLL_DEADLINE_MS
  let state = 'unknown'

  for (;;) {
    const res = await httpWithRetry(
      'status',
      `${SARVAM_BASE}/${encodeURIComponent(jobId)}/status`,
      { method: 'GET', headers: { 'api-subscription-key': sarvamApiKey } },
      true,
    )

    if ('error' in res) {
      if (res.terminal) return { kind: 'failed', error: res.error }
      return { kind: 'still_running', state, detail: res.error }
    }

    state = stringField(res.body, 'job_state') ?? 'unknown'

    if (state === 'Completed') {
      const details = field(res.body, 'job_details')
      const list = Array.isArray(details) ? details : []
      for (const d of list) {
        const outputs = field(d, 'outputs')
        const first = Array.isArray(outputs) ? outputs[0] : undefined
        const outputFile = stringField(first, 'file_name')
        if (stringField(d, 'state') === 'Success' && outputFile) {
          return { kind: 'done', outputFile }
        }
      }
      const taskError = list.map((d) => stringField(d, 'error_message')).find((m) => m !== null)
      return { kind: 'failed', error: `Sarvam job completed without output: ${taskError ?? 'no error message'}` }
    }

    if (state === 'Failed') {
      return { kind: 'failed', error: `Sarvam job failed: ${stringField(res.body, 'error_message') ?? 'no error message'}` }
    }

    if (Date.now() + POLL_INTERVAL_MS > deadline) {
      return { kind: 'still_running', state, detail: `not finished after ${POLL_DEADLINE_MS / 1000}s` }
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
  }
}

async function sarvamDownload(jobId: string, outputFile: string): Promise<{ payload: unknown } | HttpFailure> {
  const links = await httpWithRetry(
    'download links',
    `${SARVAM_BASE}/download-files`,
    sarvamPost({ job_id: jobId, files: [outputFile] }),
    true,
  )
  if ('error' in links) return links

  const downloadUrl = signedFileUrl(links.body, 'download_urls', outputFile)
  if (!downloadUrl) {
    return { error: `Sarvam download links: no download URL for ${outputFile}`, terminal: true }
  }

  const file = await httpWithRetry('download', downloadUrl, { method: 'GET' }, true)
  if ('error' in file) return file

  return { payload: file.body }
}

/**
 * What the transcript row remembers about an in-flight Sarvam job, stored in
 * raw_response until the real payload replaces it. phase 'started' is the only
 * state worth resuming: a job created but never started would sit in
 * 'Accepted' forever, so it is abandoned and a fresh job is created instead.
 */
type JobMarker = { sarvam_job_id: string; phase: 'created' | 'started'; updated_at: string }

function readJobMarker(raw: unknown): JobMarker | null {
  const jobId = stringField(raw, 'sarvam_job_id')
  const phase = stringField(raw, 'phase')
  if (!jobId || (phase !== 'created' && phase !== 'started')) return null
  return { sarvam_job_id: jobId, phase, updated_at: stringField(raw, 'updated_at') ?? '' }
}

async function saveJobMarker(transcriptId: string, jobId: string, phase: JobMarker['phase']) {
  const marker: JobMarker = { sarvam_job_id: jobId, phase, updated_at: new Date().toISOString() }
  const { error } = await db.from('transcripts').update({ raw_response: marker }).eq('id', transcriptId)
  if (error) console.error(`transcribe-recording: could not save job marker (${phase}):`, error.message)
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

  if (!(await loadConfig())) {
    // Fail closed. Without the webhook secret nothing can be authenticated,
    // and without the Sarvam key nothing can be transcribed.
    return Response.json({ error: 'Pipeline secrets are not configured' }, { status: 503 })
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

  // Setup check: does Sarvam accept the key? Asks for the status of a job id
  // that cannot exist — free, and a bad key answers 401/403 before the lookup.
  if (stringField(body, 'check') === 'sarvam') {
    const probe = await httpOnce(
      `${SARVAM_BASE}/00000000-0000-0000-0000-000000000000/status`,
      { method: 'GET', headers: { 'api-subscription-key': sarvamApiKey } },
      false,
    )
    const status = probe.kind === 'ok' ? 200 : probe.kind === 'timeout' ? 0 : probe.status
    return Response.json({
      ok: true,
      sarvam_http_status: status,
      key_accepted: status !== 0 && status !== 401 && status !== 403,
      detail: probe.kind === 'ok' ? null : probe.detail.slice(0, 200),
    })
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
    .select('id, status, raw_response')
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

  // 4. Resume an in-flight Sarvam job rather than paying for a second one. A
  //    'failed' row always starts fresh — its old job is dead by definition.
  const marker = existing?.status === 'failed' ? null : readJobMarker(existing?.raw_response)
  const resumeJobId = marker?.phase === 'started' ? marker.sarvam_job_id : null

  // 5. The batch job takes longer than the 5s pg_net enqueue timeout, so the
  //    work runs as a background task and the webhook gets an immediate 202.
  //    Every outcome — complete, failed, still running — is written to the
  //    transcript row, which is what v_transcription_backlog and the review
  //    queue read. Nothing depends on this HTTP response.
  const recording: RecordingRow = {
    id: rec.id,
    event_id: rec.event_id,
    storage_bucket: rec.storage_bucket,
    storage_path: rec.storage_path,
    duration_sec: rec.duration_sec,
    mime_type: rec.mime_type,
  }
  const job = runTranscription(recording, transcriptId, resumeJobId).catch(async (err) => {
    const detail = err instanceof Error ? err.message : String(err)
    console.error('transcribe-recording: background task crashed:', detail)
    await markFailed(transcriptId, `Background task crashed: ${detail}`)
  })
  EdgeRuntime.waitUntil(job)

  return Response.json(
    {
      ok: true,
      status: 'processing',
      transcript_id: transcriptId,
      resumed_job: resumeJobId,
    },
    { status: 202 },
  )
})

// ---------------------------------------------------------------------------
// Background work: audio → Sarvam batch job → transcript row
// ---------------------------------------------------------------------------

type RecordingRow = {
  id: string
  event_id: string
  storage_bucket: string
  storage_path: string
  duration_sec: number | null
  mime_type: string | null
}

async function runTranscription(rec: RecordingRow, transcriptId: string, resumeJobId: string | null): Promise<void> {
  let jobId = resumeJobId

  if (!jobId) {
    // 5a. Signed URL → download server-side. Audio never streams through the
    //     client; the bucket is private and stays private.
    const { data: signed, error: signErr } = await db.storage
      .from(rec.storage_bucket)
      .createSignedUrl(rec.storage_path, SIGNED_URL_TTL_SEC)

    if (signErr || !signed?.signedUrl) {
      await markFailed(transcriptId, `Could not sign storage URL: ${signErr?.message ?? 'unknown'}`)
      return
    }

    let audio: Blob
    try {
      const audioRes = await fetch(signed.signedUrl)
      if (!audioRes.ok) throw new Error(`storage returned ${audioRes.status}`)
      audio = await audioRes.blob()
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      await markFailed(transcriptId, `Audio download failed: ${detail}`)
      return
    }

    // 5b. Create → remember → upload → start → remember as started. The job
    //     id is on the row before any audio leaves, so a crash after this
    //     point is resumable rather than silently re-billed.
    const created = await sarvamCreateJob()
    if ('error' in created) {
      await markFailed(transcriptId, created.error)
      return
    }
    jobId = created.jobId
    await saveJobMarker(transcriptId, jobId, 'created')

    const filename = rec.storage_path.split('/').pop() ?? 'call.m4a'
    const mimeType = rec.mime_type || audio.type || 'audio/mp4'
    const started = await sarvamUploadAndStart(jobId, audio, filename, mimeType)
    if ('error' in started) {
      await markFailed(transcriptId, started.error)
      return
    }
    await saveJobMarker(transcriptId, jobId, 'started')
  }

  // 6. Wait for Sarvam.
  const outcome = await sarvamPoll(jobId)

  if (outcome.kind === 'still_running') {
    // Not a failure. The row stays 'processing' with the job id saved;
    // v_transcription_backlog lists it, and re-invoking this function with
    // the same recording_id resumes polling this job at no extra cost.
    const note = `Sarvam job ${jobId} still ${outcome.state} (${outcome.detail}). Re-run to resume; no new job will be billed.`
    console.warn(`transcribe-recording: ${note}`)
    await db.from('transcripts').update({ error_text: note }).eq('id', transcriptId)
    return
  }

  if (outcome.kind === 'failed') {
    // Terminal. The call STILL reaches the review queue — a staff member is
    // never blocked by this pipeline; they enter the RSVP by hand.
    await markFailed(transcriptId, outcome.error)
    return
  }

  const downloaded = await sarvamDownload(jobId, outcome.outputFile)
  if ('error' in downloaded) {
    if (downloaded.terminal) {
      await markFailed(transcriptId, downloaded.error)
    } else {
      // The job finished and is paid for; only the download was flaky. Keep
      // the row resumable instead of marking it failed and re-billing.
      await db
        .from('transcripts')
        .update({ error_text: `${downloaded.error}. Re-run to resume; no new job will be billed.` })
        .eq('id', transcriptId)
    }
    return
  }

  // 7. Normalise. raw_response keeps the ENTIRE payload — including fields we
  //    do not read today — plus the job id for traceability. Re-running
  //    extraction is ₹0.03; re-running STT is ₹0.75. Never discard anything
  //    that would force the expensive path.
  const norm = normalise(downloaded.payload)
  const payloadObject =
    downloaded.payload !== null && typeof downloaded.payload === 'object' && !Array.isArray(downloaded.payload)
      ? (downloaded.payload as Record<string, unknown>)
      : { payload: downloaded.payload }

  const { error: updErr } = await db
    .from('transcripts')
    .update({
      status: 'complete',
      raw_response: { ...payloadObject, sarvam_job_id: jobId },
      full_text: norm.fullText,
      text: norm.fullText, // legacy NOT NULL column, kept in sync
      segments: { segments: norm.segments, assumption: norm.speakerAssumption },
      detected_languages: norm.detectedLanguages,
      error_text: null,
    })
    .eq('id', transcriptId)

  if (updErr) {
    // The spend already happened. The job marker is still on the row, so a
    // re-run downloads the finished job again instead of paying twice.
    console.error('transcribe-recording: PAID BUT UNSAVED —', updErr.message)
    await db
      .from('transcripts')
      .update({ error_text: `Transcribed but could not save: ${updErr.message}. Re-run to resume.` })
      .eq('id', transcriptId)
    return
  }

  // 8. Cost. Derived, not stored.
  const thisCallHours = (rec.duration_sec ?? 0) / 3600
  const thisCallRupees = thisCallHours * RUPEES_PER_HOUR
  const totalHours = await cumulativeHours(rec.event_id)

  console.info(
    `transcribe-recording: ${rec.id} ok — job ${jobId}, ${rec.duration_sec ?? '?'}s, ` +
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
}
