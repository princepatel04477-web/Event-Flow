'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { LinkButton } from '@/components/ui/LinkButton'
import { CarIcon, PlusIcon } from '@/components/icons'
import { readFleet, type FleetData } from '@/lib/actions/fleet'
import { useStableData } from '@/lib/use-stable-data'
import { traceFetch } from '@/lib/perf'

import { QuickAddVehicles } from './QuickAddVehicles'

export interface FleetAddCardProps {
  eventId: string
  eventCode: string
}

/**
 * Fleet count + add-vehicles, for screens whose job is not the fleet.
 *
 * Departure day is when the fleet gap is discovered, and until now the only
 * place to close it was the fleet screen in another section — which meant
 * leaving the departures board, navigating two levels, adding, and coming
 * back. On a cheap handset on venue Wi-Fi that is a minute of round trips
 * at exactly the wrong moment.
 *
 * Renders nothing while loading and nothing on error: this is an auxiliary
 * affordance on someone else's screen, so a fleet-read failure must never
 * take the departures board down with it. The link out stays available in
 * that case via the departures screen's own navigation.
 */
export function FleetAddCard({ eventId, eventCode }: FleetAddCardProps) {
  const [open, setOpen] = useState(false)

  const { data, loading, error, reload } = useStableData<FleetData>(
    `fleet-add:${eventId}`,
    () => traceFetch('departures :: readFleet', () => readFleet(eventId)),
  )

  if (loading || error || !data) return null

  const count = data.vehicles.length

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <CarIcon className="h-5 w-5 shrink-0 text-muted" />
            <div className="min-w-0">
              <h3 className="font-semibold text-fg">
                {count === 0 ? 'No vehicles in fleet' : `${count} in fleet`}
              </h3>
              <p className="truncate text-sm text-muted">
                {count === 0
                  ? 'Departures cannot be scheduled until the fleet has vehicles.'
                  : 'Shared with arrivals — one fleet per event.'}
              </p>
            </div>
          </div>
          <Button
            variant={count === 0 ? 'primary' : 'secondary'}
            size="md"
            leadingIcon={<PlusIcon className="h-5 w-5" />}
            onClick={() => setOpen(!open)}
          >
            {open ? 'Done' : 'Add'}
          </Button>
        </div>
      </CardHeader>

      {open && (
        <CardBody className="flex flex-col gap-3">
          <QuickAddVehicles eventId={eventId} types={data.types} onAdded={reload} />
          <div className="border-t border-border pt-3">
            <LinkButton href={`/${eventCode}/logistics/fleet`} variant="secondary" size="md">
              Open full fleet
            </LinkButton>
          </div>
        </CardBody>
      )}
    </Card>
  )
}

export default FleetAddCard
