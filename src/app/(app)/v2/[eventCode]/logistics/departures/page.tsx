import type { Metadata } from 'next'

import { LinkButton } from '@/components/ui/LinkButton'
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
 * `logistics/departures/new`. It used to be reachable ONLY from the empty
 * state, which meant the moment the event had one departure on file the form
 * could only be reached by typing the URL — and inside the APK there is no URL
 * bar. The permanent ghost link below is the fix: quiet, never the primary,
 * and always present. The empty-state link stays where it is.
 */
export default async function DeparturesPage({ params }: PageProps) {
  const { eventCode } = await params
  const { event } = await requireTravelScreen(eventCode)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <LinkButton
          href={`/${event.code}/logistics/departures/new`}
          variant="ghost"
          size="sm"
          className="border border-rule-strong"
        >
          Record a walk-up
        </LinkButton>
      </div>

      <TravelBoard
        eventId={event.id}
        eventCode={event.code}
        direction="departure"
        otherHref={`/${event.code}/logistics/arrivals`}
      />
    </div>
  )
}
