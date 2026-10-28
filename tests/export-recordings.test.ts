/**
 * The Recordings sheet — the audio trail.
 *
 * What these tests pin down is the part that is NOT obvious from the shape of
 * the data: a recording may have several transcripts (the webhook retries 5xx
 * three times, each attempt inserting a row) and a transcript may have several
 * extractions, so "the status of this recording" is always the NEWEST row, not
 * whichever one the query happened to return first.
 */
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'

import { buildSheetDefinitions } from '@/lib/export/definitions'
import { buildWorkbook } from '@/lib/export/workbook'
import {
  buildRecordingRows,
  type CallAttemptRow,
  type CallRecordingRow,
  type ExportData,
  type GuestGroupRow,
  type RsvpExtractionRow,
  type TranscriptExportRow,
} from '@/lib/export/sheets'

function group(over: Partial<GuestGroupRow> = {}): GuestGroupRow {
  return {
    id: 'g1',
    event_id: 'e1',
    group_code: '1',
    head_name: 'Rajesh Kumar',
    primary_mobile: '9876543213',
    alt_mobile: null,
    side: 'bride',
    group_type: 'family',
    city: 'Ahmedabad',
    expected_pax: 2,
    confirmed_pax: null,
    adults_confirmed: null,
    children_confirmed: null,
    rsvp_status: 'pending',
    priority: 0,
    remarks: null,
    needs_return_gift: false,
    call_count: 0,
    callback_at: null,
    last_outcome: null,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    ...over,
  } as GuestGroupRow
}

function recording(over: Partial<CallRecordingRow> = {}): CallRecordingRow {
  return {
    id: 'r1',
    event_id: 'e1',
    group_id: 'g1',
    call_attempt_id: 'a1',
    storage_bucket: 'call-recordings',
    storage_path: 'e1/g1/note.aac',
    duration_sec: 42,
    mime_type: 'audio/aac',
    file_size_bytes: null,
    sha256: null,
    source: 'voice_note',
    consent_given: true,
    device_captured_at: null,
    recorded_at: '2026-10-28T09:00:00Z',
    uploaded_by: null,
    uploaded_by_staff: null,
    ...over,
  }
}

function attempt(over: Partial<CallAttemptRow> = {}): CallAttemptRow {
  return {
    id: 'a1',
    event_id: 'e1',
    group_id: 'g1',
    dialed_number: '9800000001',
    outcome: 'connected',
    started_at: '2026-10-28T08:58:00Z',
    ended_at: '2026-10-28T08:59:00Z',
    duration_sec: 60,
    device_started_at: null,
    finalized_at: null,
    callback_at: null,
    caller_id: null,
    caller_id_staff: null,
    notes: null,
    ...over,
  }
}

function transcript(over: Partial<TranscriptExportRow> = {}): TranscriptExportRow {
  return {
    id: 't1',
    recording_id: 'r1',
    status: 'complete',
    error_text: null,
    language: 'gu',
    full_text: 'Six people coming on the 20th.',
    text: 'Six people coming on the 20th.',
    created_at: '2026-10-28T09:01:00Z',
    ...over,
  }
}

function extraction(over: Partial<RsvpExtractionRow> = {}): RsvpExtractionRow {
  return {
    id: 'x1',
    event_id: 'e1',
    group_id: 'g1',
    transcript_id: 't1',
    call_attempt_id: 'a1',
    status: 'pending',
    parsed: {},
    fields: null,
    confidence: {},
    overall_confidence: null,
    model: null,
    model_version: null,
    prompt_version: null,
    review_notes: null,
    reviewed_at: null,
    reviewed_by: null,
    applied_at: null,
    created_at: '2026-10-28T09:02:00Z',
    ...over,
  } as RsvpExtractionRow
}

function data(over: Partial<ExportData> = {}): ExportData {
  return {
    groups: [group()],
    guests: [],
    legs: [],
    deliverables: [],
    proofs: [],
    assignments: [],
    rooms: [],
    hotels: [],
    callAttempts: [attempt()],
    extractions: [],
    recordings: [recording()],
    transcripts: [],
    profileNames: {},
    staffNames: {},
    ...over,
  }
}

describe('Recordings sheet', () => {
  it('reports a complete transcript and the extraction waiting on review', () => {
    const [row] = buildRecordingRows(
      data({ transcripts: [transcript()], extractions: [extraction()] }),
    )

    expect(row.headName).toBe('Rajesh Kumar')
    expect(row.source).toBe('Voice note')
    expect(row.transcriptStatus).toBe('Complete')
    expect(row.language).toBe('gu')
    expect(row.transcriptText).toBe('Six people coming on the 20th.')
    expect(row.extractionStatus).toBe('Awaiting review')
    expect(row.transcriptComplete).toBe(true)
  })

  it('shows the dialled number rather than the listed family mobile', () => {
    const [row] = buildRecordingRows(data())
    expect(row.phone).toBe('9800000001')
  })

  it('falls back to the family mobile when no attempt sits behind the audio', () => {
    const [row] = buildRecordingRows(
      data({ recordings: [recording({ call_attempt_id: null })], callAttempts: [] }),
    )
    expect(row.phone).toBe('9876543213')
  })

  it('marks uploaded audio that was never transcribed', () => {
    const [row] = buildRecordingRows(data())
    expect(row.transcriptStatus).toBe('Not transcribed')
    expect(row.extractionStatus).toBe('-')
    // This is the whole point of the sheet: a family whose answers sit in an
    // unread file must not look identical to one nobody called.
    expect(row.transcriptComplete).toBe(false)
  })

  it('carries the failure reason, so the deliberate under-10s skip reads as deliberate', () => {
    const [row] = buildRecordingRows(
      data({
        transcripts: [
          transcript({ status: 'failed', error_text: 'too_short', full_text: null, text: '' }),
        ],
      }),
    )
    expect(row.transcriptStatus).toBe('Failed - too_short')
    expect(row.transcriptText).toBe('')
  })

  it('takes the newest transcript when the webhook retried', () => {
    const [row] = buildRecordingRows(
      data({
        transcripts: [
          transcript({
            id: 't-old',
            status: 'failed',
            error_text: 'upstream 502',
            created_at: '2026-10-28T09:01:00Z',
          }),
          transcript({ id: 't-new', status: 'complete', created_at: '2026-10-28T09:05:00Z' }),
        ],
      }),
    )
    expect(row.transcriptStatus).toBe('Complete')
  })

  it('takes the newest extraction when one superseded another', () => {
    const [row] = buildRecordingRows(
      data({
        transcripts: [transcript()],
        extractions: [
          extraction({ id: 'x-old', status: 'superseded', created_at: '2026-10-28T09:02:00Z' }),
          extraction({ id: 'x-new', status: 'committed', created_at: '2026-10-28T09:09:00Z' }),
        ],
      }),
    )
    expect(row.extractionStatus).toBe('Applied')
  })

  it('orders oldest first and numbers the rows in that order', () => {
    const rows = buildRecordingRows(
      data({
        recordings: [
          recording({
            id: 'r-late',
            storage_path: 'e1/g1/late.aac',
            recorded_at: '2026-10-28T11:00:00Z',
          }),
          recording({
            id: 'r-early',
            storage_path: 'e1/g1/early.aac',
            recorded_at: '2026-10-28T07:00:00Z',
          }),
        ],
      }),
    )
    expect(rows.map((r) => r.audioFile)).toEqual(['e1/g1/early.aac', 'e1/g1/late.aac'])
    expect(rows.map((r) => r.recordingIndex)).toEqual([1, 2])
  })

  it('names an orphan recording rather than dropping it', () => {
    const [row] = buildRecordingRows(
      data({
        recordings: [recording({ group_id: null, call_attempt_id: null })],
        callAttempts: [],
      }),
    )
    expect(row.headName).toBe('Unknown')
    expect(row.phone).toBe('')
  })
})

// ---------------------------------------------------------------------------
// The wiring. A perfect row builder that nothing calls produces an export with
// no Recordings tab, which is exactly the bug this sheet exists to fix — so the
// tab itself is asserted, not just the rows.
// ---------------------------------------------------------------------------

describe('Recordings sheet is wired into the workbook', () => {
  it('appears as the last tab, with its headers and its row', () => {
    const wb = buildWorkbook(
      buildSheetDefinitions(data({ transcripts: [transcript()], extractions: [extraction()] })),
    )

    expect(wb.SheetNames).toContain('Recordings')
    expect(wb.SheetNames[wb.SheetNames.length - 1]).toBe('Recordings')

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Recordings'])
    expect(rows).toHaveLength(1)
    expect(Object.keys(rows[0])).toEqual([
      '#',
      'Family head',
      'Phone',
      'Recorded',
      'Duration (s)',
      'Source',
      'Transcript',
      'Lang',
      'Extraction',
      'Transcript text',
      'Audio file',
    ])
    expect(rows[0]['Family head']).toBe('Rajesh Kumar')
    expect(rows[0]['Audio file']).toBe('e1/g1/note.aac')
    // Phones are forced to string cells everywhere in this workbook; a number
    // cell drops the leading zero and Excel reformats it as 9.8E+9.
    expect(rows[0]['Phone']).toBe('9800000001')
  })
})
