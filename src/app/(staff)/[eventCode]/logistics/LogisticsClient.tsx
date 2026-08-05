'use client'

import { useState, useCallback, useEffect } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Spinner } from '@/components/ui/Spinner'
import { LinkButton } from '@/components/ui/LinkButton'
import {
  ShieldAlertIcon,
  UsersIcon,
} from '@/components/icons'
import {
  readUnplacedTravelLegs,
  readAvailableVehicles,
  packTrips,
  commitTrips,
  type TravelLegForLogistics,
  type VehicleForPacking,
  type LogisticsProposal,
} from '@/lib/actions/logistics'
import { cn } from '@/lib/utils'

interface Props {
  eventId: string
}

type Tab = 'arrivals' | 'departures'
type Phase =
  | { stage: 'loading' }
  | { stage: 'ready'; legs: TravelLegForLogistics[]; vehicles: VehicleForPacking[]; proposal: LogisticsProposal | null; committed: boolean; commitError: string | null }
  | { stage: 'error'; message: string }
  | { stage: 'empty'; message: string }

export function LogisticsClient({ eventId }: Props) {
  const [tab, setTab] = useState<Tab>('arrivals')
  const [phase, setPhase] = useState<Phase>({ stage: 'loading' })
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState<Set<Tab>>(new Set())

  const direction = tab === 'arrivals' ? 'arrival' : 'departure'

  const load = useCallback(async (dir: 'arrival' | 'departure') => {
    setPhase({ stage: 'loading' })
    try {
      const [legs, vehicles] = await Promise.all([
        readUnplacedTravelLegs(eventId, dir),
        readAvailableVehicles(eventId),
      ])

      if (legs.length === 0 || vehicles.length === 0) {
        const msg = legs.length === 0 && vehicles.length === 0
          ? 'No travel legs need transport and no vehicles are available.'
          : legs.length === 0
            ? `No ${dir} legs need transport right now.`
            : 'No vehicles available — add vehicles to the fleet first.'
        setPhase({ stage: 'empty', message: msg })
        return
      }

      const proposal = await packTrips(legs, vehicles)
      setPhase({ stage: 'ready', legs, vehicles, proposal, committed: false, commitError: null })
    } catch {
      setPhase({ stage: 'error', message: 'Could not load logistics data.' })
    }
  }, [eventId])

  const handleTabSwitch = useCallback((newTab: Tab) => {
    setTab(newTab)
    const newDir = newTab === 'arrivals' ? 'arrival' : 'departure'
    if (!loaded.has(newTab)) {
      setLoaded((prev) => new Set(prev).add(newTab))
      load(newDir)
    } else {
      load(newDir)
    }
  }, [loaded, load])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load('arrival') }, [load])

  const handleCommit = async () => {
    if (phase.stage !== 'ready' || !phase.proposal) return
    setSaving(true)
    const result = await commitTrips(eventId, phase.proposal)
    if (result.ok) {
      setPhase({ ...phase, committed: true, commitError: null })
    } else {
      setPhase({ ...phase, commitError: result.error })
    }
    setSaving(false)
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
        icon={<ShieldAlertIcon className="h-7 w-7" />}
        title="Could not load logistics"
        description={phase.message}
        action={<Button onClick={() => load(direction)}>Retry</Button>}
      />
    )
  }

  if (phase.stage === 'empty') {
    return (
      <EmptyState
        icon={<UsersIcon className="h-7 w-7" />}
        title="Nothing to plan"
        description={phase.message}
        action={<Button onClick={() => load(direction)}>Refresh</Button>}
      />
    )
  }

  const { proposal, committed, commitError } = phase

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold text-fg">Trip planning</h2>
        <p className="mt-0.5 text-sm text-muted">
          {committed
            ? 'Plan committed. Trips are created.'
            : 'Review the proposal, then commit. Nothing is written until you commit.'}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex rounded-xl border border-border bg-surface p-1">
        {(['arrivals', 'departures'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => handleTabSwitch(t)}
            className={cn(
              'tap flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
              tab === t
                ? 'bg-brand text-brand-fg'
                : 'text-muted hover:text-fg',
            )}
          >
            {t === 'arrivals' ? 'Arrivals' : 'Departures'}
          </button>
        ))}
      </div>

      {commitError && (
        <div className="rounded-xl border border-tint-danger bg-tint-danger px-4 py-3 text-sm text-danger">
          {commitError}
        </div>
      )}

      {!proposal || proposal.trips.length === 0 ? (
        <p className="text-sm text-muted">No trips could be formed from available legs and vehicles.</p>
      ) : (
        <>
          {/* Summary */}
          <div className="rounded-xl border border-border bg-surface px-4 py-3">
            <div className="flex items-baseline gap-4 text-sm">
              <span>
                <span className="font-semibold text-fg">{proposal.trips.length}</span>
                <span className="text-muted"> trip{proposal.trips.length !== 1 ? 's' : ''}</span>
              </span>
              <span>
                <span className="font-semibold text-fg">
                  {proposal.trips.reduce((s, t) => s + t.seatsUsed, 0)}
                </span>
                <span className="text-muted"> seats used</span>
              </span>
              {proposal.unplaced.length > 0 && (
                <span>
                  <span className="font-semibold text-danger">{proposal.unplaced.length}</span>
                  <span className="text-muted"> unplaced</span>
                </span>
              )}
            </div>
          </div>

          {/* Trips */}
          <div className="flex flex-col gap-3">
            {proposal.trips.map((trip, i) => (
              <Card key={`${trip.vehicleId}-${i}`}>
                <CardBody>
                  <div className="mb-2 flex items-center gap-2">
                    <h3 className="font-semibold text-fg">
                      {trip.vehicleLabel ?? 'Unnamed vehicle'}
                    </h3>
                    <Badge tone="neutral" size="sm">
                      {trip.seatsUsed}/{trip.capacity}
                    </Badge>
                    {trip.driverName && (
                      <span className="ml-auto text-xs text-muted">{trip.driverName}</span>
                    )}
                  </div>

                  <div className="mb-2 flex gap-2 text-xs text-muted">
                    <span>{trip.pickupPoint}</span>
                    {trip.scheduledTime && <span>· {trip.scheduledTime}</span>}
                  </div>

                  <ul className="flex flex-col gap-1">
                    {trip.groups.map((g) => (
                      <li
                        key={g.travelLegId}
                        className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-1.5 text-sm"
                      >
                        <span className="min-w-0 flex-1 truncate font-medium">{g.headName}</span>
                        <span className="shrink-0 text-muted">
                          {g.pax} {g.pax === 1 ? 'person' : 'people'}
                        </span>
                        {g.travelTime && (
                          <span className="shrink-0 text-xs text-subtle">{g.travelTime}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </CardBody>
              </Card>
            ))}
          </div>

          {/* Unplaced */}
          {proposal.unplaced.length > 0 && (
            <Card>
              <CardBody>
                <h3 className="mb-2 font-semibold text-danger">Could not place</h3>
                <ul className="flex flex-col gap-2">
                  {proposal.unplaced.map((u) => (
                    <li key={u.travelLegId} className="rounded-lg border border-tint-danger bg-surface-2 px-3 py-2 text-sm">
                      <p className="font-medium text-fg">
                        {u.headName} ({u.pax} PAX)
                      </p>
                      {u.date && u.time && (
                        <p className="text-xs text-muted">
                          {u.date} {u.time}{u.point ? ` · ${u.point}` : ''}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-danger">{u.reason}</p>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </>
      )}

      <div className="flex gap-3 pt-2">
        {!committed && proposal && proposal.trips.length > 0 && (
          <Button fullWidth onClick={handleCommit} loading={saving}>
            Commit plan
          </Button>
        )}
        {committed && (
          <LinkButton fullWidth variant="secondary" href={`/${eventId}/fleet`}>
            Back to fleet
          </LinkButton>
        )}
      </div>
    </div>
  )
}
