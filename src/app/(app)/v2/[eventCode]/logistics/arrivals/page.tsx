import type { Metadata } from 'next'

import { TravelBoard } from '../_components/TravelBoard'
import { requireTravelScreen } from '../_guard'

export const metadata: Metadata = {
  title: 'Arrivals',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
}

/**
 * Meet an arrival — the board of families still expected.
 *
 * The guard is `requireTravelScreen`, which is the same `requireSection(...,
 * 'logistics')` call the legacy section layout makes: a travel runner and an
 * event lead get in, a hospitality or hamper runner is bounced to their own
 * home with `?denied=section`, exactly as they were before this section was
 * rebuilt.
 *
 * The board is loaded with `direction="arrival"` and is handed the departures
 * address for its Segmented switch. The switch navigates rather than holding
 * both directions in local state, because the v3 bar highlights whichever of
 * these two addresses the runner tapped — a local switch would leave the tapped
 * tab lit and the visible board disagreeing with it.
 */
export default async function ArrivalsPage({ params }: PageProps) {
  const { eventCode } = await params
  const { event } = await requireTravelScreen(eventCode)

  return (
    <TravelBoard
      eventId={event.id}
      eventCode={event.code}
      direction="arrival"
      otherHref={`/${event.code}/logistics/departures`}
    />
  )
}
