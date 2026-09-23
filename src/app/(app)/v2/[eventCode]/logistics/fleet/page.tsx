import type { Metadata } from 'next'

import { FleetBoard } from './FleetBoard'
import { requireTravelScreen } from '../_guard'

export const metadata: Metadata = {
  title: 'Fleet',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
}

/**
 * The fleet: what the event can carry people in.
 *
 * Guarded by the section guard, like every screen in Travel. A hospitality or
 * hamper runner is bounced to their own home with `?denied=section`, which is
 * what the legacy section layout did for this route before it was rebuilt.
 */
export default async function FleetPage({ params }: PageProps) {
  const { eventCode } = await params
  const { event } = await requireTravelScreen(eventCode)

  return <FleetBoard eventId={event.id} eventCode={event.code} />
}
