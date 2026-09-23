import type { Metadata } from 'next'

import { DeliveryDetail } from '@/app/(staff)/[eventCode]/hospitality/deliveries/[deliverableId]/DeliveryDetail'

import { requireHamperScreen } from '../../hospitality/deliveries/_guard'

export const metadata: Metadata = {
  title: 'Hamper proof',
}

type PageProps = {
  params: Promise<{ eventCode: string; deliverableId: string }>
}

/**
 * The proof screen for one hamper, reached from the Hampers tab.
 *
 * WAS A STALE v1 RE-EXPORT — see `../page.tsx` for why the whole Hamper route
 * moved onto the v3 components. `DeliveryDetail` is shared between this route
 * and `hospitality/deliveries/[deliverableId]`, and `backTo` existed precisely
 * so both can point their exit links at the list the person came from instead
 * of at a section they are not a member of (R3: every way off a screen must
 * lead somewhere they are allowed to go).
 */
export default async function HamperDetailPage({ params }: PageProps) {
  const { eventCode, deliverableId } = await params
  const { event } = await requireHamperScreen(eventCode)

  return (
    <DeliveryDetail
      eventId={event.id}
      eventCode={event.code}
      deliverableId={deliverableId}
      backTo="hamper"
      backLabel="the hamper run"
    />
  )
}
