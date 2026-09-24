import type { Metadata } from 'next'

import { TravelBoard } from '../_components/TravelBoard'
import { requireTravelScreen } from '../_guard'

export const metadata: Metadata = {
  title: 'Departures',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
}

/**
 * Who is leaving — the departures side of the Travel board.
 *
 * The same component as `/logistics/arrivals` with `direction="departure"`, so
 * the two boards cannot drift apart in a fix: there is one grouping rule, one
 * status vocabulary and one sheet. The write is `markDeparted`, the same RPC
 * the v1 board calls, through the same optimistic path.
 *
 * Recording a walk-up departure — a family who tells the desk they are leaving
 * and was never called about it — stays its own screen at
 * `logistics/departures/new`, which is where a staff member who has just been
 * told a flight time needs to be. It has exactly ONE door on this board, owned
 * by `TravelBoard`: the empty state's button while there is nothing on file, and
 * a quiet "Record a walk-up" link above the board once there is. The two are
 * mutually exclusive — an empty board must not offer the same control twice, and
 * a board with rows on it must still be able to reach the form (inside the APK
 * there is no URL bar to type it into). See the N2 comment in `TravelBoard`.
 */
export default async function DeparturesPage({ params }: PageProps) {
  const { eventCode } = await params
  const { event } = await requireTravelScreen(eventCode)

  return (
    <TravelBoard
      eventId={event.id}
      eventCode={event.code}
      direction="departure"
      otherHref={`/${event.code}/logistics/arrivals`}
    />
  )
}
