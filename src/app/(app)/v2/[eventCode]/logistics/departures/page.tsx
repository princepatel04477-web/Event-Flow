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
 * told a flight time needs to be. It is reachable from the empty state here
 * rather than from a permanent button on the board: a board that has rows on it
 * is a board someone is working, not a form.
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
