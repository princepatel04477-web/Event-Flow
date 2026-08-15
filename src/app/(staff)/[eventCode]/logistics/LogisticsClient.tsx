'use client'

import { useCallback, useState } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { LinkButton } from '@/components/ui/LinkButton'
import {
  CarIcon,
  MapPinIcon,
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
import { traceFetch } from '@/lib/perf'
import { useStableData } from '@/lib/use-stable-data'
import { mapsDirectionsHref } from '@/lib/phone'
import { openExternalAppUrl } from '@/lib/native/navigation'
import { cn } from '@/lib/utils'

interface Props {
  eventId: string
  eventCode: string
}

type Tab = 'arrivals' | 'departures'

interface LogisticsData {
  legs: TravelLegForLogistics[]
  vehicles: VehicleForPacking[]
  proposal: LogisticsProposal | null
}

/** Why there is nothing to plan. `no-vehicles` is the actionable one. */
interface EmptyReason {
  empty: string
  reason: 'no-vehicles' | 'no-legs'
}

export function LogisticsClient({ eventId, eventCode }: Props) {
  const [tab, setTab] = useState<Tab>('arrivals')
  const [saving, setSaving] = useState(false)
  const [committed, setCommitted] = useState(false)
  const [commitError, setCommitError] = useState<string | null>(null)

  const loadFor = useCallback(
    (dir: 'arrival' | 'departure'): Promise<LogisticsData | EmptyReason> =>
      traceFetch(`logistics :: readData(${dir})`, async () => {
        const [legs, vehicles] = await Promise.all([
          readUnplacedTravelLegs(eventId, dir),
          readAvailableVehicles(eventId),
        ])

        // An empty fleet is not the same problem as an empty leg list, and
        // the difference decides what the user must do next — so carry the
        // reason, not just a sentence. A fleet gap is the only one of these
        // that is fixable from here, and it is the one that silently
        // produces a plan with nothing in it.
        if (legs.length === 0 || vehicles.length === 0) {
          if (vehicles.length === 0) {
            return {
              empty: legs.length === 0
                ? 'No vehicles in the fleet, and no travel legs need transport yet.'
                : `No vehicles in the fleet. ${legs.length} ${dir} ${legs.length === 1 ? 'leg needs' : 'legs need'} transport and none can be scheduled until the fleet has vehicles.`,
              reason: 'no-vehicles' as const,
            }
          }
          return {
            empty: `No ${dir} legs need transport right now.`,
            reason: 'no-legs' as const,
          }
        }

        const proposal = await traceFetch(`logistics :: packTrips(${dir})`, () =>
          packTrips(legs, vehicles, dir),
        )
        return { legs, vehicles, proposal }
      }),
    [eventId],
  )

  // One cached fetch per direction, so flipping the arrivals/departures tabs
  // renders from cache on the second visit instead of re-querying Supabase.
  // The departure direction is mounted lazily — fetching both directions on
  // first load would do ~12s of cumulative work just to show one tab.
  const arrivals = useStableData<LogisticsData | EmptyReason>(
    `logistics:arrival:${eventId}`,
    () => loadFor('arrival'),
  )
  const departures = useStableData<LogisticsData | EmptyReason>(
    `logistics:departure:${eventId}`,
    () => loadFor('departure'),
    // Mount only once the user opens the departures tab; until then the
    // fetch would be wasted work on a screen nobody is looking at.
    { disabled: tab !== 'departures' },
  )

  const active = tab === 'arrivals' ? arrivals : departures

  const handleTabSwitch = useCallback((newTab: Tab) => {
    setTab(newTab)
    setCommitted(false)
    setCommitError(null)
  }, [])

  const handleCommit = async () => {
    const data = active.data
    if (!data || 'empty' in data || !data.proposal) return
    setSaving(true)
    const result = await commitTrips(eventId, data.proposal)
    if (result.ok) {
      setCommitted(true)
      setCommitError(null)
    } else {
      setCommitError(result.error)
    }
    setSaving(false)
  }

  if (active.loading) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <div className="h-6 w-32 rounded bg-rule-strong" />
          <div className="mt-1.5 h-4 w-56 rounded bg-rule" />
        </div>
        <div className="flex rounded-xl border border-border bg-surface p-1">
          <div className="h-11 flex-1 rounded-lg bg-rule" />
          <div className="h-11 flex-1 rounded-lg" />
        </div>
        <div className="rounded-xl border border-border bg-surface px-4 py-3">
          <div className="h-4 w-1/3 rounded bg-rule" />
        </div>
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-center gap-2">
              <div className="h-5 w-2/5 rounded bg-rule-strong" />
              <div className="h-5 w-14 rounded-full bg-rule" />
            </div>
            <div className="mt-2 h-4 w-1/3 rounded bg-rule" />
            <div className="mt-3 space-y-1.5">
              <div className="h-4 w-3/4 rounded bg-rule" />
              <div className="h-4 w-2/3 rounded bg-rule" />
              <div className="h-4 w-1/2 rounded bg-rule" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  const data = active.data

  if (active.error) {
    return (
      <EmptyState
        icon={<ShieldAlertIcon className="h-7 w-7" />}
        title="Could not load logistics"
        description="Could not load logistics data."
        action={<Button onClick={active.reload}>Retry</Button>}
      />
    )
  }

  if (!data || 'empty' in data) {
    const message =
      data && 'empty' in data ? data.empty : 'No travel legs or vehicles on file yet.'
    const noVehicles = Boolean(data && 'empty' in data && data.reason === 'no-vehicles')

    // A missing fleet is fixable, so say where — an empty state that only
    // names the problem sends staff hunting through the nav on a handset.
    return (
      <EmptyState
        icon={noVehicles ? <CarIcon className="h-7 w-7" /> : <UsersIcon className="h-7 w-7" />}
        title={noVehicles ? 'No vehicles in the fleet' : 'Nothing to plan'}
        description={message}
        action={
          noVehicles ? (
            <div className="flex flex-col items-center gap-2">
              <LinkButton href={`/${eventCode}/logistics/fleet`} size="md">
                Add vehicles to the fleet
              </LinkButton>
              <Button variant="secondary" onClick={active.reload}>
                Refresh
              </Button>
            </div>
          ) : (
            <Button onClick={active.reload}>Refresh</Button>
          )
        }
      />
    )
  }

  const { proposal } = data

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
              'tap flex min-h-12 flex-1 items-center justify-center rounded-lg px-3 py-2 text-sm font-semibold transition-colors active:opacity-80',
              tab === t
                ? 'bg-brand text-brand-fg'
                : 'text-muted hover:text-fg active:bg-surface-2',
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
                    {/* §5.7: source → destination directions link. Plain maps
                        deep link, no API. Opens in the OS, never the WebView. */}
                    {(() => {
                      const href = mapsDirectionsHref(trip.pickupPoint, null)
                      if (!href) return null
                      return (
                        <button
                          type="button"
                          onClick={() => openExternalAppUrl(href)}
                          aria-label={`Directions for ${trip.pickupPoint || 'this trip'}`}
                          className="tap ml-auto inline-flex min-h-8 items-center gap-1 rounded-md px-2 font-medium text-brand active:opacity-70"
                        >
                          <MapPinIcon className="h-4 w-4" />
                          Directions
                        </button>
                      )
                    })()}
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
