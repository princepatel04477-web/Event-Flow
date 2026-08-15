import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { requireStaff, resolveEventByCode } from '@/lib/supabase/queries'

import { DeliveryDetail } from '../../hospitality/deliveries/[deliverableId]/DeliveryDetail'

/**
 * The proof screen for one hamper, under the Hamper section.
 *
 * Imported, not copied — see the note in ../page.tsx. `DeliveryList` links to
 * its detail rows relative to whichever tree it is rendered in, so this route
 * has to exist or every row on the Hamper tab would 404.
 */
export const metadata: Metadata = {
  title: 'Hamper proof',
}

type PageProps = {
  params: Promise<{ eventCode: string; deliverableId: string }>
}

export default async function HamperDetailPage({ params }: PageProps) {
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
