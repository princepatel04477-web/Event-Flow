import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { requireStaff, resolveEventByCode } from '@/lib/supabase/queries'

import { DeliveryList } from '../hospitality/deliveries/DeliveryList'

/**
 * Hamper — its own top-level section.
 *
 * WHY THIS ROUTE EXISTS RATHER THAN A CHILD TAB. `SECTIONS` gives each
 * section a `children` array, but nothing in the app renders one: BottomTabs
 * reads `children` only to pick which screen a tab lands on, and there is no
 * child tab strip anywhere. So the only navigable level is the section
 * itself, and a screen listed as a child of another section is unreachable
 * unless it happens to be that section's default — which is how hampers sat
 * invisible under Hospitality while being fully built. (CLAUDE.md §12: "A
 * section can be complete, deployed, and still invisible".)
 *
 * The component is IMPORTED from the hospitality tree, not copied. There are
 * already two live copies of the deliveries screen and a third would mean
 * every future fix needs making three times.
 */
export const metadata: Metadata = {
  title: 'Hamper',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
}

export default async function HamperPage({ params }: PageProps) {
  const { eventCode } = await params

  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  const access = await requireStaff(event.id, event.code)

  return (
    <div className="flex flex-col gap-4">
      <DeliveryList
        eventId={event.id}
        eventCode={event.code}
        // Keep row taps inside this section — see DeliveryListProps.detailBase.
        detailBase="hamper"
        // Deliverable generation is admin-only (mirrors import) — event_team
        // members deliver, they do not mint the run.
        canImport={access === 'admin'}
      />
    </div>
  )
}
