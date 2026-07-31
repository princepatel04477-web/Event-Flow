import type { Metadata } from 'next'
import { Suspense } from 'react'
import { notFound } from 'next/navigation'

import { Spinner } from '@/components/ui/Spinner'
import { getEventByCode } from '@/lib/supabase/queries'
import { QueueBoard } from './QueueBoard'

export const metadata: Metadata = {
  title: 'Calling Queue',
}

type PageProps = {
  // Next 15+ hands params over as a Promise.
  params: Promise<{ eventCode: string }>
}

export default async function QueuePage({ params }: PageProps) {
  const { eventCode } = await params

  const event =
    (await getEventByCode(eventCode)) ?? (await getEventByCode(eventCode.toUpperCase()))
  if (!event) notFound()

  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      }
    >
      <QueueBoard eventId={event.id} eventCode={event.code} />
    </Suspense>
  )
}
