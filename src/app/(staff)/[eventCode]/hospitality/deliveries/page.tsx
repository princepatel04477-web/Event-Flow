import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { requireStaff, resolveEventByCode } from '@/lib/supabase/queries'

import { DeliveryList } from './DeliveryList'

export const metadata: Metadata = {
  title: 'Deliveries',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
}

export function generateStaticParams(): Array<Record<string, string>> {
  return []
}

export default async function DeliveriesPage({ params }: PageProps) {
  const { eventCode } = await params

  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  const access = await requireStaff(event.id, event.code)

  return (
    <div className="flex flex-col gap-4">
      <DeliveryList
        eventId={event.id}
        eventCode={event.code}
        // Deliverable generation is admin-only (mirrors import) — event_team
        // members deliver, they do not mint the run.
        canImport={access === 'admin'}
      />
    </div>
  )
}
