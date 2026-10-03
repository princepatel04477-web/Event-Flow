import 'jsr:@supabase/functions-js/edge-runtime.d.ts'

import { createClient } from 'npm:@supabase/supabase-js@2'
import * as XLSX from 'npm:xlsx@0.18.5'

/**
 * call-log-excel — keeps ONE live Excel file per event with a row for every
 * recorded call, rebuilt whenever a call is recorded, transcribed, extracted
 * or reviewed.
 *
 *   eventflow-exports/{event_id}/call-log-live.xlsx
 *
 * Staff of that event can read it (existing bucket policy: first folder is
 * the event id). A row in export_files (kind 'call_log_live') points at it so
 * the Files screen can list it.
 *
 * TRIGGER: database triggers on call_recordings (insert), transcripts (status
 * change) and rsvp_extractions (insert / status or parsed change) call this
 * through pg_net with {event_id}. Migration *_call_log_live_excel.sql.
 *
 * WHAT A ROW SAYS: the values a human accepted on the review screen when
 * there are any ("Checked"), otherwise the AI draft ("AI draft - check").
 * The file is a READ-ONLY view of the database; nothing here writes guest data.
 *
 * SECURITY: service role, but its only writes are this one storage object and
 * its export_files row. Callers must present the shared webhook secret.
 */

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
})

const BUCKET = 'eventflow-exports'
const FILE_NAME = 'call-log-live.xlsx'
const EXPORT_KIND = 'call_log_live'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const TRANSCRIPT_MAX_CHARS = 2000

// ---------------------------------------------------------------------------
// Secret (Vault first, env fallback; same pattern as transcribe-recording)
// ---------------------------------------------------------------------------

const CONFIG_TTL_MS = 5 * 60_000
let webhookSecret = ''
let configLoadedAt = 0

async function loadConfig(): Promise<boolean> {
  if (webhookSecret && Date.now() - configLoadedAt < CONFIG_TTL_MS) return true
  const { data, error } = await db.rpc('pipeline_secret', { p_name: 'call_log_webhook_secret' })
  if (error) console.error('call-log-excel: could not read secret from Vault:', error.message)
  const value = typeof data === 'string' && data !== '' ? data : Deno.env.get('CALL_LOG_WEBHOOK_SECRET') ?? ''
  if (!value) return false
  webhookSecret = value
  configLoadedAt = Date.now()
  return true
}

// ---------------------------------------------------------------------------
// Reading helpers for jsonb columns
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>

function obj(v: unknown): Json {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {}
}

function text(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.filter((x) => x !== null && x !== undefined).map(String).join(', ')
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  return String(v)
}

/** fields.<name>.value from an extraction's per-field JSON. */
function fieldValue(fields: Json, name: string): unknown {
  return obj(fields[name]).value
}

const IST = 'Asia/Kolkata'
function istDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('en-GB', { timeZone: IST }) : ''
}
function istTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleTimeString('en-GB', { timeZone: IST, hour: '2-digit', minute: '2-digit' }) : ''
}
function duration(sec: number | null): string {
  if (sec === null || sec === undefined) return ''
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

const RSVP_LABEL: Record<string, string> = {
  confirmed: 'Coming',
  declined: 'Not coming',
  tentative: 'Maybe',
  callback: 'Call back',
  unreachable: 'No answer',
  not_started: 'Not called',
  attempted: 'Tried',
}
const MODE_LABEL: Record<string, string> = { air: 'Flight', train: 'Train', bus: 'Bus', cab: 'Cab', self_drive: 'Own car' }
const TRANSCRIPT_LABEL: Record<string, string> = {
  pending: 'Transcribing',
  processing: 'Transcribing',
  complete: 'Done',
  failed: 'Failed',
}
const REVIEW_LABEL: Record<string, string> = {
  accepted: 'Checked',
  committed: 'Checked',
  pending: 'AI draft - check',
  in_review: 'AI draft - check',
  draft: 'AI failed - enter by hand',
  rejected: 'Rejected',
  superseded: 'Replaced',
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const HEADERS = [
  'Date', 'Time', 'Family', 'Phone', 'Staff', 'Duration', 'Consent',
  'Transcript', 'RSVP', 'People', 'Arrival date', 'Arrival time', 'Arrival by', 'Flight / train', 'Arrival point',
  'Departure date', 'Departure time', 'Departure by', 'Pickup', 'Special requests', 'Call back at',
  'AI notes', 'AI confidence', 'Status', 'What was said',
]

async function buildRows(eventId: string): Promise<{ rows: string[][]; eventName: string } | { error: string }> {
  const [ev, recs, groups, staff, transcripts, extractions] = await Promise.all([
    db.from('events').select('name').eq('id', eventId).maybeSingle(),
    db.from('call_recordings')
      .select('id, group_id, recorded_at, duration_sec, consent_given, uploaded_by_staff')
      .eq('event_id', eventId)
      .order('recorded_at', { ascending: true }),
    db.from('guest_groups').select('id, head_name, primary_mobile').eq('event_id', eventId),
    db.from('staff_members').select('id, full_name').eq('event_id', eventId),
    db.from('transcripts').select('id, recording_id, status, full_text, text, error_text').eq('event_id', eventId),
    db.from('rsvp_extractions')
      .select('id, transcript_id, status, parsed, fields, overall_confidence, review_notes, created_at')
      .eq('event_id', eventId)
      .order('created_at', { ascending: true }),
  ])
  const failed = [ev, recs, groups, staff, transcripts, extractions].find((r) => r.error)
  if (failed?.error) return { error: failed.error.message }
  if (!ev.data) return { error: 'Event not found' }

  const groupById = new Map((groups.data ?? []).map((g) => [g.id as string, g]))
  const staffById = new Map((staff.data ?? []).map((s) => [s.id as string, s.full_name as string]))
  const transcriptByRecording = new Map((transcripts.data ?? []).map((t) => [t.recording_id as string, t]))
  // Latest non-superseded extraction per transcript (list is oldest first).
  const extractionByTranscript = new Map<string, Json>()
  for (const e of extractions.data ?? []) {
    if (e.status === 'superseded' || !e.transcript_id) continue
    extractionByTranscript.set(e.transcript_id as string, e as Json)
  }

  const rows: string[][] = []
  for (const r of recs.data ?? []) {
    const g = groupById.get(r.group_id as string)
    const t = transcriptByRecording.get(r.id as string)
    const e = t ? extractionByTranscript.get(t.id as string) : undefined
    const status = e ? String(e.status) : ''
    const parsed = obj(e?.parsed)
    const fields = obj(e?.fields)
    const arrival = obj(parsed.arrival)
    const departure = obj(parsed.departure)
    const hasValues = e !== undefined && status !== 'draft' && status !== 'rejected'
    const v = (x: unknown) => (hasValues ? text(x) : '')

    const transcriptStatus = !r.consent_given
      ? 'Not sent (no consent)'
      : t
        ? (TRANSCRIPT_LABEL[String(t.status)] ?? String(t.status)) + (t.status === 'failed' && t.error_text ? `: ${String(t.error_text).slice(0, 80)}` : '')
        : 'Waiting'
    const said = t ? String(t.full_text ?? t.text ?? '') : ''

    rows.push([
      istDate(r.recorded_at as string | null),
      istTime(r.recorded_at as string | null),
      text(g?.head_name) || 'Unknown family',
      text(g?.primary_mobile),
      r.uploaded_by_staff ? (staffById.get(r.uploaded_by_staff as string) ?? '') : '',
      duration(r.duration_sec as number | null),
      r.consent_given ? 'Yes' : 'No',
      transcriptStatus,
      v(RSVP_LABEL[text(parsed.rsvp_status)] ?? parsed.rsvp_status),
      v(parsed.confirmed_pax),
      v(arrival.date),
      v(arrival.time),
      v(MODE_LABEL[text(arrival.mode)] ?? arrival.mode),
      v(arrival.reference),
      v(arrival.point),
      v(departure.date),
      v(departure.time),
      v(MODE_LABEL[text(departure.mode)] ?? departure.mode),
      v(fieldValue(fields, 'needs_pickup')),
      v(parsed.remarks ?? parsed.special_requests),
      v(fieldValue(fields, 'callback_datetime')),
      e ? text(status === 'draft' ? e.review_notes : fieldValue(fields, 'notes')) : '',
      v(e?.overall_confidence),
      e ? (REVIEW_LABEL[status] ?? status) : t?.status === 'complete' ? 'Reading the call' : '',
      said.length > TRANSCRIPT_MAX_CHARS ? `${said.slice(0, TRANSCRIPT_MAX_CHARS)}...` : said,
    ])
  }
  return { rows, eventName: String(ev.data.name) }
}

function toWorkbook(rows: string[][], eventName: string): ArrayBuffer {
  const updated = new Date().toLocaleString('en-GB', { timeZone: IST })
  const sheet = XLSX.utils.aoa_to_sheet([
    [`${eventName} - call log (updates itself after every call). Last updated ${updated} IST.`],
    ['"AI draft - check" rows are unverified: confirm them on the review screen before relying on them.'],
    [],
    HEADERS,
    ...rows,
  ])
  const widths = [11, 7, 24, 14, 16, 8, 8, 18, 11, 7, 12, 9, 10, 14, 18, 12, 9, 10, 7, 24, 16, 30, 10, 18, 60]
  sheet['!cols'] = widths.map((wch) => ({ wch }))
  sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 3, c: 0 }, e: { r: 3 + rows.length, c: HEADERS.length - 1 } }) }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, 'Calls')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

async function rebuild(eventId: string): Promise<{ ok: true; rows: number; path: string; bytes: number } | { ok: false; error: string }> {
  const built = await buildRows(eventId)
  if ('error' in built) return { ok: false, error: built.error }

  const bytes = toWorkbook(built.rows, built.eventName)
  const path = `${eventId}/${FILE_NAME}`
  const { error: upErr } = await db.storage
    .from(BUCKET)
    .upload(path, bytes, { upsert: true, contentType: XLSX_MIME, cacheControl: '0' })
  if (upErr) return { ok: false, error: `upload: ${upErr.message}` }

  // One export_files row per event for the live file: update if present.
  const { data: existing } = await db
    .from('export_files')
    .select('id')
    .eq('event_id', eventId)
    .eq('kind', EXPORT_KIND)
    .limit(1)
  const meta = { event_id: eventId, kind: EXPORT_KIND, format: 'xlsx', path, bytes: bytes.byteLength, created_at: new Date().toISOString() }
  const { error: rowErr } =
    existing && existing.length > 0
      ? await db.from('export_files').update(meta).eq('id', existing[0].id)
      : await db.from('export_files').insert(meta)
  if (rowErr) console.error('call-log-excel: export_files row not saved:', rowErr.message)

  return { ok: true, rows: built.rows.length, path, bytes: bytes.byteLength }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 })
  if (!(await loadConfig())) return Response.json({ error: 'Pipeline secrets are not configured' }, { status: 503 })
  if (req.headers.get('x-webhook-secret') !== webhookSecret) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: Json
  try {
    body = obj(await req.json())
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 })
  }
  const eventId = typeof body.event_id === 'string' ? body.event_id : null
  if (!eventId) return Response.json({ error: 'event_id required' }, { status: 400 })

  const result = await rebuild(eventId)
  if (!result.ok) console.error(`call-log-excel: rebuild failed for ${eventId}: ${result.error}`)
  return Response.json(result, { status: result.ok ? 200 : 500 })
})
