'use client'

import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { ShieldAlertIcon } from '@/components/icons'
import { readKmDashboard, type KmDashboardData } from '@/lib/actions/fleet'
import { useStableData } from '@/lib/use-stable-data'
import { traceFetch } from '@/lib/perf'
import { cn } from '@/lib/utils'

interface Props {
  eventId: string
}

/**
 * KM counting dashboard (§3.4).
 *
 * Per vehicle: total KM, total trips, and a fairness indicator — how far
 * each vehicle sits from the fleet average. All figures are computed at
 * query time from odometer_logs + trips; nothing is stored. Read-only view.
 *
 * The fairness bar is intentionally simple: a vehicle at +80 km over the
 * average is being run into the ground while a neighbour sits idle, and on
 * the day that is the number the transport lead needs, not a chart.
 */
export function KmDashboard({ eventId }: Props) {
  const { data, loading, error, reload } = useStableData<KmDashboardData | null>(
    `fleet-km:${eventId}`,
    () => traceFetch('fleet :: readKmDashboard', () => readKmDashboard(eventId)),
  )

  if (loading && !data) {
    return (
      <Card>
        <CardHeader>
          <h3 className="font-semibold text-fg">KM summary</h3>
        </CardHeader>
        <CardBody>
          <div className="flex flex-col gap-2" aria-busy>
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="h-12 rounded-lg bg-surface-2" />
            ))}
          </div>
        </CardBody>
      </Card>
    )
  }

  if (error && !data) {
    return (
      <Card>
        <CardHeader>
          <h3 className="font-semibold text-fg">KM summary</h3>
        </CardHeader>
        <CardBody>
          <EmptyState
            icon={<ShieldAlertIcon className="h-7 w-7" />}
            title="Could not load KM data"
            description={error instanceof Error ? error.message : 'Could not load KM data.'}
            action={<Button onClick={reload}>Retry</Button>}
          />
        </CardBody>
      </Card>
    )
  }

  if (!data) return null

  const maxAbs = Math.max(1, ...data.vehicles.map((v) => Math.abs(v.deltaFromAverageKm)))

  return (
    <Card>
      <CardHeader>
        <div>
          <h3 className="font-semibold text-fg">KM summary</h3>
          <p className="text-sm text-muted">
            {data.vehicles.length} vehicles · {data.totalKm} km logged · fleet
            average {data.fleetAverageKm} km
          </p>
        </div>
      </CardHeader>
      <CardBody>
        {data.vehicles.length === 0 ? (
          <p className="text-sm text-muted">No vehicles to measure yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {data.vehicles.map((v) => {
              const over = v.deltaFromAverageKm > 0
              const under = v.deltaFromAverageKm < 0
              const width = Math.min(100, (Math.abs(v.deltaFromAverageKm) / maxAbs) * 100)
              return (
                <li key={v.vehicleId} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-medium text-ink">
                      {v.vehicleLabel ?? 'Unnamed'}
                    </span>
                    <span className="figure shrink-0 text-sm text-muted">
                      {v.totalKm} km · {v.tripCount} trips
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className={cn(
                          'absolute inset-y-0 left-1/2 rounded-full transition-all duration-500',
                          over
                            ? 'bg-ledger-red'
                            : under
                              ? 'bg-brand'
                              : 'bg-muted/40',
                        )}
                        style={
                          v.deltaFromAverageKm === 0
                            ? { width: '2px', left: 'calc(50% - 1px)' }
                            : over
                              ? { left: '50%', width: `${width}%` }
                              : { right: '50%', width: `${width}%` }
                        }
                      />
                    </div>
                    <span
                      className={cn(
                        'figure w-16 shrink-0 text-right font-mono text-xs',
                        over ? 'text-ledger-red' : under ? 'text-brand' : 'text-muted',
                      )}
                    >
                      {v.deltaFromAverageKm > 0 ? '+' : ''}
                      {v.deltaFromAverageKm} km
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        <p className="mt-3 text-xs leading-relaxed text-muted">
          Over-used (red) or under-used (brand) relative to the fleet average.
          Figures are live from odometer logs and trips — nothing stored.
        </p>
      </CardBody>
    </Card>
  )
}
