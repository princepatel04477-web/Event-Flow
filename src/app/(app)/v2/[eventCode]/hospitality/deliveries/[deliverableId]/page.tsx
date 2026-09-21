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
 * The proof screen for one hamper, under the v2 hamper list.
 *
 * `DeliveryDetail` IS IMPORTED, NOT COPIED, and that is the point: UX-RULES R1
 * names it as the app's best screen, the write it seals is insert-only and
 * irreversible (CLAUDE.md §5.2), and a second copy of it would be a second
 * place for the capture, the confirmation and the `loading` button to drift
 * apart. The repo already does exactly this across route groups — see
 * `(staff)/[eventCode]/hamper/[deliverableId]/page.tsx`, which imports it from
 * the hospitality tree.
 *
 * The two links OUT of that component are pointed back at THIS tree's list
 * rather than the v1 hospitality one, which is the reason `backTo`/`backLabel`
 * exist as props at all (R3: every way off a screen must lead somewhere the
 * person using it is allowed to go).
 *
 * WHY THE SHARED GUARD AND NOT `requireSection('hospitality')`: this list is
 * the hamper team's screen as much as the hospitality team's — see `_guard.ts`.
 * A hamper runner reaching the proof for their own run is the normal case, and
 * the v1 tree reached this same component through the `hamper` section layout.
 */
export default async function HamperProofPage({ params }: PageProps) {
  const { eventCode, deliverableId } = await params
  const { event } = await requireHamperScreen(eventCode)

  return (
    <div className="flex flex-col gap-4">
      <DeliveryDetail
        eventId={event.id}
        eventCode={event.code}
        deliverableId={deliverableId}
        backTo="hospitality/deliveries"
        backLabel="the hamper list"
      />
    </div>
  )
}
