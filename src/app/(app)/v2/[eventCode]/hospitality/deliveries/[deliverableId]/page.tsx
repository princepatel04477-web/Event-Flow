import type { Metadata } from 'next'

import { DeliveryDetail } from '@/app/(staff)/[eventCode]/hospitality/deliveries/[deliverableId]/DeliveryDetail'

import { requireHamperScreen } from '../_guard'

export const metadata: Metadata = {
  title: 'Hamper proof',
}

type PageProps = {
  params: Promise<{ eventCode: string; deliverableId: string }>
}

/**
 * The proof screen for one hamper, under the v2-era path.
 *
 * This route and `hamper/[deliverableId]` render the same component with the
 * same exit links, so it does not matter which address a runner arrived from —
 * which is the point. It survives because `DeliverableDetail` rows written
 * before the Hampers tab landed still point here, and a 404 on the seal screen
 * is the worst possible one.
 *
 * `DeliveryDetail` IS IMPORTED, NOT COPIED: UX-RULES R1 names it as the app's
 * best screen, the write it seals is insert-only and irreversible (CLAUDE.md
 * §5.2), and a second copy would be a second place for the capture, the
 * confirmation and the `loading` button to drift apart.
 *
 * The two links OUT of it point at the hamper run, which is the canonical list
 * — `hospitality/deliveries` is now a redirect to it, so pointing a back link
 * at that path would spend a round trip on venue Wi-Fi to arrive at the same
 * screen (R3: every way off a screen must land somewhere the person may go).
 *
 * WHY THE SHARED GUARD AND NOT `requireSection('hospitality')`: this screen is
 * the hamper team's as much as the hospitality team's — see `_guard.ts`. A
 * hamper runner reaching the proof for their own run is the normal case.
 */
export default async function HamperProofPage({ params }: PageProps) {
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
