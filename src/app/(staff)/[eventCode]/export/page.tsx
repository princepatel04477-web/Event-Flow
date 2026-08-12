import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { SectionHead } from '@/components/ui/SectionHead'
import { requireStaff, resolveEventByCode } from '@/lib/supabase/queries'
import { ExportClient } from './ExportClient'

export const metadata: Metadata = {
  title: 'Export',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
}

export function generateStaticParams(): Array<Record<string, string>> {
  return [{}]
}

export default async function ExportPage({ params }: PageProps) {
  const { eventCode } = await params

  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  await requireStaff(event.id, event.code)

  return (
    <div className="flex flex-col gap-4">
      <SectionHead eyebrow="Spreadsheets" title="Excel export" />
      <ExportClient eventId={event.id} />
    </div>
  )
}
