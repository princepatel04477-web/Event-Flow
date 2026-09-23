import type { Metadata } from 'next'

import { requireTravelScreen } from '../_guard'

import { DriverSheetsBoard } from './DriverSheetsBoard'

export const metadata: Metadata = {
  title: 'Driver sheets',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
}

/**
 * Driver sheets — one sheet per committed trip.
 *
 * Not a tab in either nav model (it is reached from the trip planner), but a
 * real screen a logistics runner opens on departure day, so it is guarded and
 * rebuilt with the rest of Travel rather than left as a v1 re-export under a v3
 * shell — which would have shown a v2-era card wall inside the new look.
 */
export default async function DriverSheetsPage({ params }: PageProps) {
  const { eventCode } = await params
  const { event } = await requireTravelScreen(eventCode)

  return <DriverSheetsBoard eventId={event.id} eventCode={event.code} />
}
