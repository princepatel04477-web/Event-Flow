'use client'

import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { StatusPill } from '@/components/ui/StatusPill'
import { readVehicleAvailability, type VehicleAvailability } from '@/lib/actions/fleet'
import { useStableData } from '@/lib/use-stable-data'
import { traceFetch } from '@/lib/perf'

interface Props {
  eventId: string
}

/**
 * Vehicle availability (§3.5). "Is this car free after the drop-off?"
 * answered from committed trips at query time: a vehicle shows its next
 * pickup and the moment it is free again. Derived state only — there is
 * deliberately no availability column anywhere.
 */
export function VehicleAvailabilityPanel({ eventId }: Props) {
  const { data: rows } = useStableData<VehicleAvailability[] | null>(
    `fleet-availability:${eventId}`,
    () => traceFetch('fleet :: readVehicleAvailability', () => readVehicleAvailability(eventId)),
  )

  if (!rows) return null

  return (
    <Card>
      <CardHeader>
        <div>
          <h3 className="font-semibold text-fg">Availability</h3>
          <p className="text-sm text-muted">
            Next committed pickup per vehicle, from the trip board.
          </p>
        </div>
      </CardHeader>
      <CardBody>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">No vehicles on the ground yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((r) => (
              <li key={r.vehicleId} className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 p-2.5 text-sm">
                <span className="min-w-0 truncate font-medium text-ink">
                  {r.vehicleLabel ?? 'Unnamed'}
                </span>
                {r.free ? (
                  <StatusPill tone="done">Free</StatusPill>
                ) : (
                  <span className="shrink-0 font-mono text-xs text-muted">
                    {r.nextPickupAt ? new Date(r.nextPickupAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  )
}
