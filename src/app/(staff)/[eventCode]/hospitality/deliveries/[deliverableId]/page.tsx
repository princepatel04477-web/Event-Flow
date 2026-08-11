import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { requireStaff, resolveEventByCode } from '@/lib/supabase/queries'

import { DeliveryDetail } from './DeliveryDetail'

export const metadata: Metadata = {
  title: 'Delivery proof',
}

type PageProps = {
  params: Promise<{ eventCode: string; deliverableId: string }>
}

export default async function DeliveryDetailPage({ params }: PageProps) {
  const { eventCode, deliverableId } = await params

  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  await requireStaff(event.id, event.code)

  return (
    <div className="flex flex-col gap-4">
      <DeliveryDetail eventId={event.id} eventCode={event.code} deliverableId={deliverableId} />
    </div>
  )
}
