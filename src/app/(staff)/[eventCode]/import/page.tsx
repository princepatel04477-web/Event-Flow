import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { getEventByCode } from '@/lib/supabase/queries'

import { ImportWizard } from './_components/ImportWizard'

export const metadata: Metadata = {
  title: 'Import guests',
}

type PageProps = {
  // Next 15+ hands params over as a Promise.
  params: Promise<{ eventCode: string }>
}

export default async function ImportPage({ params }: PageProps) {
  const { eventCode } = await params

  const event =
    (await getEventByCode(eventCode)) ?? (await getEventByCode(eventCode.toUpperCase()))
  if (!event) notFound()

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold text-fg">Excel import</h2>
        <p className="mt-0.5 text-sm text-muted">
          Upload the calling list, map its columns, review the preview, then confirm. Nothing
          writes to the database until you approve it.
        </p>
      </div>

      <ImportWizard eventId={event.id} eventCode={event.code} />
    </div>
  )
}
