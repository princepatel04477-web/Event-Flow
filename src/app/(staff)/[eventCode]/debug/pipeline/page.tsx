import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { requireStaff, resolveEventByCode } from '@/lib/supabase/queries'

export const metadata: Metadata = {
  title: 'Pipeline',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
}

type ExtractionBacklogRow = {
  transcript_id: string | null
  group_id: string | null
  recording_id: string | null
  transcribed_at: string | null
  transcript_chars: number | null
}

export default async function PipelineDebugPage({ params }: PageProps) {
  const { eventCode } = await params

  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  await requireStaff(event.id, event.code)

  const supabase = await createClient()

  const {
    count: transcriptionCount,
    data: transcriptionRows,
    error: transcriptionError,
  } = await supabase
    .from('v_transcription_backlog')
    .select('*', { count: 'exact', head: false })
    .eq('event_id', event.id)
    .order('recorded_at', { ascending: false, nullsFirst: false })
    .limit(20)

  // Renders as "unavailable" rather than "0" below, so a failed query cannot
  // masquerade as an empty backlog. Log it too: this is a diagnostic page, and
  // a backlog that silently fails to load is worse than one that reports a
  // number, because the reader trusts the screen either way.
  if (transcriptionError) {
    console.error('[debug/pipeline] transcription backlog query failed', {
      sqlstate: transcriptionError.code,
      eventId: event.id,
      message: transcriptionError.message?.slice(0, 200),
    })
  }

  let extractionCount: number | null = null
  let extractionRows: ExtractionBacklogRow[] = []
  let extractionUnavailable = false

  const extraction = await supabase
    // v_extraction_backlog is not present in the generated types yet; it is
    // created by the POST-EVENT extraction migration (20260812100000).
    .from('v_extraction_backlog' as never)
    .select('*', { count: 'exact', head: false })
    .eq('event_id', event.id)
    .order('transcribed_at', { ascending: false, nullsFirst: false })
    .limit(20)

  // supabase-js resolves with { data, error }; it does not throw for a query
  // error, so read the error explicitly. 42P01 = the view does not exist yet.
  if (extraction.error) {
    if (extraction.error.code === '42P01') {
      extractionUnavailable = true
    } else {
      throw extraction.error
    }
  } else {
    extractionCount = extraction.count ?? null
    extractionRows = (extraction.data ?? []) as ExtractionBacklogRow[]
  }

  return (
    <main>
      <h1>Pipeline</h1>

      <section>
        <h2>Transcription backlog ({transcriptionCount === null ? 'unavailable' : transcriptionCount})</h2>
        <table>
          <thead>
            <tr>
              <th>recording_id</th>
              <th>transcript_id</th>
              <th>status</th>
              <th>recorded_at</th>
              <th>duration_sec</th>
              <th>error_text</th>
            </tr>
          </thead>
          <tbody>
            {(transcriptionRows ?? []).map((row) => (
              <tr key={row.recording_id ?? row.transcript_id ?? undefined}>
                <td>{row.recording_id}</td>
                <td>{row.transcript_id}</td>
                <td>{row.status}</td>
                <td>{row.recorded_at}</td>
                <td>{row.duration_sec}</td>
                <td>{row.error_text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Extraction backlog ({extractionUnavailable ? 'view pending' : extractionCount === null ? 'unavailable' : extractionCount})</h2>
        {extractionUnavailable ? (
          <p>v_extraction_backlog is not deployed yet (post-event extraction migration pending).</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>transcript_id</th>
                <th>recording_id</th>
                <th>transcribed_at</th>
                <th>transcript_chars</th>
              </tr>
            </thead>
            <tbody>
              {extractionRows.map((row) => (
                <tr key={row.transcript_id ?? row.recording_id ?? undefined}>
                  <td>{row.transcript_id}</td>
                  <td>{row.recording_id}</td>
                  <td>{row.transcribed_at}</td>
                  <td>{row.transcript_chars}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  )
}
