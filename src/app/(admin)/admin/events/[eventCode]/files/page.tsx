import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { listExports } from '@/lib/actions/files'
import { resolveEventByCode } from '@/lib/supabase/queries'

import { FilesClient } from './FilesClient'

export const metadata: Metadata = { title: 'Files' }

type PageProps = { params: Promise<{ eventCode: string }> }

/**
 * The Files area (A11).
 *
 * Every export the app can produce, generated on demand, stored privately and
 * listed with its history so yesterday's file can be re-downloaded without
 * touching the event again.
 */
export default async function AdminEventFilesPage({ params }: PageProps) {
  const { eventCode } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  const rows = await listExports(event.id)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-xl leading-tight font-semibold tracking-tight text-ink">
          Files
        </h1>
        <p className="mt-1 text-sm text-muted">
          Generate and download every export for this event. Stored files keep a one-hour download link.
        </p>
      </div>

      <FilesClient eventId={event.id} initial={rows} />
    </div>
  )
}
