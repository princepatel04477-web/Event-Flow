'use client'

import { useState, useCallback, useEffect } from 'react'
import * as XLSX from 'xlsx'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Spinner } from '@/components/ui/Spinner'
import { FileTextIcon } from '@/components/icons'
import {
  readDriverSheets,
  type DriverSheetTrip,
} from '@/lib/actions/departures'

interface Props {
  eventId: string
}

type Phase =
  | { stage: 'loading' }
  | { stage: 'ready'; trips: DriverSheetTrip[] }
  | { stage: 'error'; message: string }

export function DriverSheetsClient({ eventId }: Props) {
  const [phase, setPhase] = useState<Phase>({ stage: 'loading' })
  const [expandedTrip, setExpandedTrip] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const trips = await readDriverSheets(eventId)
      setPhase({ stage: 'ready', trips })
    } catch {
      setPhase({ stage: 'error', message: 'Could not load driver sheets.' })
    }
  }, [eventId])

  /** Retry: back to the spinner, then re-fetch. */
  const reload = useCallback(() => {
    setPhase({ stage: 'loading' })
    void load()
  }, [load])

  // NOT `useState(() => load())`. A useState initializer runs DURING render,
  // so the setPhase inside load() fired mid-render ("Cannot update a
  // component while rendering a different component") and ran on the server
  // too, which desynced the SSR markup from the first client render and
  // produced a hydration mismatch on every visit. Fetching is a side effect
  // and belongs in an effect.
  useEffect(() => {
    void load()
  }, [load])

  const formatWhatsApp = (trip: DriverSheetTrip): string => {
    const lines = [
      `🚗 *${trip.vehicleLabel ?? 'Trip'}*`,
      '',
      `Driver: ${trip.driverName ?? 'Not assigned'}`,
      `Contact: ${trip.driverMobile ?? 'N/A'}`,
      trip.scheduledTime ? `Time: ${new Date(trip.scheduledTime).toLocaleString()}` : '',
      trip.pickupPoint ? `Pickup: ${trip.pickupPoint}` : '',
      trip.dropPoint ? `Drop: ${trip.dropPoint}` : '',
      '',
      '*Families:*',
      ...trip.families.map(
        (f, i) =>
          `${i + 1}. ${f.headName} — ${f.pax} PAX${f.contactNumber ? ` · ${f.contactNumber}` : ''}`,
      ),
    ]
    return lines.filter(Boolean).join('\n')
  }

  const handleCopy = (trip: DriverSheetTrip) => {
    navigator.clipboard.writeText(formatWhatsApp(trip))
  }

  const handleExportAll = () => {
    if (phase.stage !== 'ready') return
    const rows = phase.trips.flatMap((t) =>
      t.families.map((f) => ({
        Vehicle: t.vehicleLabel ?? 'Unnamed',
        Driver: t.driverName ?? '',
        'Driver mobile': t.driverMobile ?? '',
        'Scheduled at': t.scheduledTime ? new Date(t.scheduledTime).toLocaleString() : '',
        Pickup: t.pickupPoint ?? '',
        Drop: t.dropPoint ?? '',
        Direction: t.direction,
        Family: f.headName,
        PAX: f.pax,
        Contact: f.contactNumber ?? '',
      })),
    )
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Driver Sheets')
    XLSX.writeFile(wb, 'driver_sheets.xlsx')
  }

  if (phase.stage === 'loading') {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner size="md" />
      </div>
    )
  }

  if (phase.stage === 'error') {
    return (
      <EmptyState
        icon={<FileTextIcon className="h-7 w-7" />}
        title="Could not load driver sheets"
        description={phase.message}
        action={<Button onClick={reload}>Retry</Button>}
      />
    )
  }

  const { trips } = phase

  if (trips.length === 0) {
    return (
      <EmptyState
        icon={<FileTextIcon className="h-7 w-7" />}
        title="No planned trips"
        description="Plan trips first from the trips tab. Driver sheets are created when trips are committed."
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-fg">Driver sheets</h2>
        <Button variant="secondary" size="md" onClick={handleExportAll}>
          Export all
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        {trips.map((trip) => {
          const isExpanded = expandedTrip === trip.tripId
          return (
            <Card key={trip.tripId}>
              <button
                type="button"
                onClick={() => setExpandedTrip(isExpanded ? null : trip.tripId)}
                className="tap w-full text-left"
              >
                <CardHeader>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-fg">
                      {trip.vehicleLabel ?? 'Unnamed vehicle'}
                    </h3>
                    <p className="text-sm text-muted">
                      {trip.driverName ? `Driver: ${trip.driverName}` : 'No driver'}
                      {trip.families.length > 0 && ` · ${trip.families.length} families`}
                    </p>
                  </div>
                  <Badge tone="info" size="sm">
                    {trip.direction}
                  </Badge>
                </CardHeader>
              </button>

              {isExpanded && (
                <CardBody className="border-t border-border pt-4">
                  <div className="mb-3 flex flex-col gap-1 text-sm">
                    {trip.scheduledTime && (
                      <p className="text-fg">
                        <span className="text-muted">Time: </span>
                        {new Date(trip.scheduledTime).toLocaleString()}
                      </p>
                    )}
                    {trip.pickupPoint && (
                      <p className="text-fg">
                        <span className="text-muted">Pickup: </span>
                        {trip.pickupPoint}
                      </p>
                    )}
                    {trip.dropPoint && (
                      <p className="text-fg">
                        <span className="text-muted">Drop: </span>
                        {trip.dropPoint}
                      </p>
                    )}
                    {trip.driverMobile && (
                      <p className="text-fg">
                        <span className="text-muted">Contact: </span>
                        {trip.driverMobile}
                      </p>
                    )}
                  </div>

                  <h4 className="mb-2 text-sm font-semibold text-fg">Families</h4>
                  <ul className="mb-4 flex flex-col gap-1">
                    {trip.families.map((f, i) => (
                      <li
                        key={`${trip.tripId}-${i}`}
                        className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-1.5 text-sm"
                      >
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {f.headName}
                        </span>
                        <Badge tone="neutral" size="sm">
                          {f.pax} PAX
                        </Badge>
                        {f.contactNumber && (
                          <span className="text-xs text-muted">{f.contactNumber}</span>
                        )}
                      </li>
                    ))}
                  </ul>

                  <Button
                    fullWidth
                    variant="secondary"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleCopy(trip)
                    }}
                  >
                    Copy for WhatsApp
                  </Button>
                </CardBody>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
