import type { Metadata } from 'next'

import { LogisticsClient } from '@/app/(staff)/[eventCode]/logistics/LogisticsClient'

import { requireTravelScreen } from '../_guard'

export const metadata: Metadata = {
  title: 'Trips',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
}

/**
 * The trip planner: read the unplaced legs, pack them into the fleet, review the
 * proposal, commit it.
 *
 * RESTYLED, NOT REDESIGNED (SPEC-V3 §4), and for this screen the honest restyle
 * is an import rather than a rewrite. `LogisticsClient` is the trip-planning
 * ENGINE's face: `readUnplacedTravelLegs` + `readAvailableVehicles` +
 * `packTrips` + `commitTrips`, with the advisory/unplaced split and the
 * one-fleet-per-event invariant CLAUDE.md §6 pins. Rebuilding its markup would
 * mean re-expressing those rules in a second component, which is exactly the
 * duplication that has cost this repo before.
 *
 * It is reached from the Travel board's family sheet ("Plan vehicles for this
 * board") — which is where a runner is when they have a board to plan against —
 * and from the driver sheets screen.
 */
export default async function TripsPage({ params }: PageProps) {
  const { eventCode } = await params
  const { event } = await requireTravelScreen(eventCode)

  return <LogisticsClient eventId={event.id} eventCode={event.code} />
}
