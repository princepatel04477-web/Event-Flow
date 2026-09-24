'use client'

import { useState } from 'react'

import { CarIcon, PlusIcon } from '@/components/icons'
import { Button } from '@/components/ui/Button'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { LinkButton } from '@/components/ui/LinkButton'
import { LoadingRows } from '@/components/ui/LoadingRows'
import { Row, type RowTone } from '@/components/ui/Row'
import { DriverRoster } from '@/components/fleet/DriverRoster'
import { KmDashboard } from '@/components/fleet/KmDashboard'
import { OdometerEntry, OdometerRecent } from '@/components/fleet/OdometerEntry'
import { QuickAddVehicles } from '@/components/fleet/QuickAddVehicles'
import { VehicleAvailabilityPanel } from '@/components/fleet/VehicleAvailability'
import { deleteVehicle, readFleet, setVehicleAvailability, type VehicleRow } from '@/lib/actions/fleet'
import {
  availabilityActionLabel,
  removeVehicleConsequence,
  removeVehicleQuestion,
} from '@/lib/fleet/remove-vehicle-copy'
import { traceFetch } from '@/lib/perf'
import { useStableData } from '@/lib/use-stable-data'

export interface FleetBoardProps {
  eventId: string
  eventCode: string
}

/**
 * The fleet: what can carry people, and what each vehicle actually carries.
 *
 * RESTYLED, NOT REDESIGNED (SPEC-V3 §4). This screen is a back-office tool — it
 * is set up before the event and corrected during it — so the shape is
 * unchanged: the vehicle list, the driver roster, the odometer form, the KM
 * totals and the availability panel are all still here, and every one of them
 * is still the same component reading the same action.
 *
 * WHAT THE RESTYLE ACTUALLY CHANGED, and why it is worth the churn:
 *
 *   - The vehicle list is `Row`s in one register instead of a stack of cards
 *     carrying a `StatusPill`. Three statuses become three WORDS with a dot,
 *     which is what makes a column of twenty scannable at arm's length.
 *   - The capacity figure keeps the mono face and the sticker count keeps its
 *     strikethrough, because "17 carried, 20 on the sticker" is the single most
 *     expensive fact on this screen (CLAUDE.md §6 — dispatching to the sticker
 *     number leaves a family standing at the airport).
 *   - The four panels (drivers, odometer, KM, availability) moved into ONE
 *     sheet behind "Manage" instead of running the length of the screen above
 *     the vehicles. They are configuration; a travel runner opens this screen to
 *     check a capacity, not to read a dashboard.
 *   - `PageTitle` is gone. The shell already renders a `ScreenHeader` for
 *     `/logistics/fleet`, so the screen used to say "Fleet" twice.
 *
 * REMOVAL IS NO LONGER A ONE-TAP HARD DELETE. `deleteVehicle` destroys the
 * vehicle and its odometer, driver and trip history, and nothing can restore
 * it. The sheet's default quiet action is now the reversible one — marking the
 * vehicle unavailable — and the delete sits behind a confirmation that names
 * the vehicle and its registration number.
 */
export function FleetBoard({ eventId, eventCode }: FleetBoardProps) {
  const [addOpen, setAddOpen] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [openVehicleId, setOpenVehicleId] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const [availabilityBusy, setAvailabilityBusy] = useState(false)

  const { data, loading, error, reload } = useStableData(
    `fleet:${eventId}`,
    () => traceFetch('fleet :: readFleet', () => readFleet(eventId)),
  )

  const vehicleOptions = (data?.vehicles ?? []).map((v) => ({ id: v.id, label: v.label }))
  const openVehicle = openVehicleId
    ? ((data?.vehicles ?? []).find((v) => v.id === openVehicleId) ?? null)
    : null

  function closeVehicle() {
    setOpenVehicleId(null)
    setConfirmRemove(false)
  }

  /** The reversible move: take the vehicle out of service, or put it back. */
  async function handleToggleAvailability(vehicle: VehicleRow) {
    setAvailabilityBusy(true)
    setActionError(null)
    const next = vehicle.status === 'unavailable' ? 'available' : 'unavailable'
    const result = await setVehicleAvailability(vehicle.id, next)
    setAvailabilityBusy(false)
    if (result.ok) {
      await reload()
    } else {
      setActionError(result.error)
    }
  }

  async function handleRemove(vehicleId: string) {
    setRemoving(true)
    const result = await deleteVehicle(vehicleId)
    setRemoving(false)
    if (result.ok) {
      closeVehicle()
      await reload()
    } else {
      setActionError(result.error)
    }
  }

  if (loading) return <LoadingRows count={5} />

  if (error || !data) {
    return (
      <ErrorState
        title="Could not load the fleet"
        description={error instanceof Error ? error.message : 'Could not load fleet data.'}
        onRetry={reload}
      />
    )
  }

  const assigned = data.vehicles.filter((v) => v.status === 'assigned').length
  const unavailable = data.vehicles.filter((v) => v.status === 'unavailable').length

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-sm text-muted">
          {data.vehicles.length === 0
            ? 'No vehicles yet'
            : `${data.vehicles.length} on the ground · capacity with luggage`}
          {assigned > 0 ? ` · ${assigned} on a trip` : ''}
          {unavailable > 0 ? ` · ${unavailable} unavailable` : ''}
        </p>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="border border-rule-strong"
            onClick={() => setManageOpen(true)}
          >
            Manage
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="border border-rule-strong"
            leadingIcon={<PlusIcon className="h-4 w-4" />}
            onClick={() => setAddOpen(true)}
          >
            Add
          </Button>
        </div>
      </div>

      {actionError ? (
        <p
          role="alert"
          className="rounded-xl bg-red-tint px-3.5 py-3 text-sm font-medium text-ledger-red"
        >
          {actionError}
        </p>
      ) : null}

      {data.vehicles.length === 0 ? (
        <EmptyState
          icon={<CarIcon className="h-7 w-7" />}
          title="No vehicles in the fleet"
          description="Add them here, then trip planning can put families in them."
          action={
            <Button variant="secondary" fullWidth onClick={() => setAddOpen(true)}>
              Add vehicles
            </Button>
          }
        />
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-rule bg-surface">
          {data.vehicles.map((vehicle) => (
            <li key={vehicle.id}>
              <Row
                heading={vehicle.label ?? 'Unnamed vehicle'}
                meta={vehicleMeta(vehicle)}
                badge={<CapacityBadge capacity={vehicle.capacity} />}
                status={statusMeta(vehicle.status).label}
                tone={statusMeta(vehicle.status).tone}
                onPress={() => setOpenVehicleId(vehicle.id)}
              />
            </li>
          ))}
        </ul>
      )}

      {/* Quick-add, in a sheet: it is a setup step, not a screen state. */}
      <BottomSheet open={addOpen} onClose={() => setAddOpen(false)} label="Add vehicles">
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-ink">Add vehicles</h2>
          <p className="text-sm text-muted">
            Set a count for each type, then tap Add — repeat to build the fleet.
          </p>
          <QuickAddVehicles eventId={eventId} types={data.types} onAdded={reload} />
        </div>
      </BottomSheet>

      {/* The four configuration panels, one level down. */}
      <BottomSheet
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        label="Fleet set-up"
      >
        <div className="flex flex-col gap-6">
          <h2 className="text-lg font-semibold text-ink">Fleet set-up</h2>
          <DriverRoster eventId={eventId} vehicles={vehicleOptions} />
          <OdometerEntry eventId={eventId} vehicles={vehicleOptions} onSaved={reload} />
          <OdometerRecent eventId={eventId} />
          <KmDashboard eventId={eventId} />
          <VehicleAvailabilityPanel eventId={eventId} />
          <Button variant="secondary" size="lg" fullWidth onClick={() => setManageOpen(false)}>
            Done
          </Button>
        </div>
      </BottomSheet>

      {/* One vehicle: what it is, who drives it, and the two ways out — the
          reversible one first, the irreversible one behind a confirmation. */}
      <BottomSheet
        open={openVehicle !== null}
        onClose={closeVehicle}
        label={openVehicle ? (openVehicle.label ?? 'Vehicle') : 'Vehicle'}
      >
        {openVehicle ? (
          confirmRemove ? (
            <div className="flex flex-col gap-5">
              <div className="min-w-0">
                <h2 className="font-display text-2xl leading-tight font-semibold text-ink">
                  {removeVehicleQuestion(openVehicle)}
                </h2>
                <p className="mt-2 text-sm text-muted">{removeVehicleConsequence()}</p>
              </div>

              {actionError ? (
                <p
                  role="alert"
                  className="rounded-xl bg-red-tint px-3.5 py-3 text-sm font-medium text-ledger-red"
                >
                  {actionError}
                </p>
              ) : null}

              <Button
                variant="danger"
                size="lg"
                fullWidth
                disabled={removing}
                onClick={() => void handleRemove(openVehicle.id)}
              >
                {removing ? 'Removing…' : 'Remove for good'}
              </Button>
              <Button variant="ghost" size="lg" fullWidth onClick={() => setConfirmRemove(false)}>
                Keep it
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              <div className="min-w-0">
                <h2 className="font-display text-2xl leading-tight font-semibold text-ink">
                  {openVehicle.label ?? 'Unnamed vehicle'}
                </h2>
                <p className="mt-1 text-sm text-muted">{vehicleMeta(openVehicle)}</p>
              </div>

              <dl className="flex flex-col">
                <SheetRow label="Capacity" value={`${openVehicle.capacity} with luggage`} mono />
                {openVehicle.seatLabel ? (
                  <SheetRow label="Sticker" value={openVehicle.seatLabel} />
                ) : null}
                <SheetRow label="Status" value={statusMeta(openVehicle.status).label} />
                {openVehicle.driverName ? (
                  <SheetRow label="Driver" value={openVehicle.driverName} />
                ) : null}
                {openVehicle.vendorName ? (
                  <SheetRow label="Vendor" value={openVehicle.vendorName} />
                ) : null}
                {openVehicle.rateNote ? (
                  <SheetRow label="Rate" value={openVehicle.rateNote} />
                ) : null}
              </dl>

              {openVehicle.driverMobile ? (
                <a
                  href={`tel:${openVehicle.driverMobile}`}
                  className="tap flex min-h-12 items-center gap-2 font-mono text-base font-medium text-brand active:opacity-70"
                >
                  {openVehicle.driverMobile}
                </a>
              ) : null}

              <LinkButton href={`/${eventCode}/logistics/trips`} variant="secondary" fullWidth>
                Plan trips with this fleet
              </LinkButton>

              {/* The quiet default: reversible, and it keeps every reading and
                  trip the vehicle already has. */}
              <Button
                variant="secondary"
                size="lg"
                fullWidth
                disabled={availabilityBusy}
                onClick={() => void handleToggleAvailability(openVehicle)}
              >
                {availabilityBusy ? 'Saving…' : availabilityActionLabel(openVehicle.status)}
              </Button>

              <Button
                variant="ghost"
                size="md"
                fullWidth
                className="border border-rule-strong"
                onClick={() => setConfirmRemove(true)}
              >
                Remove from the fleet…
              </Button>
            </div>
          )
        ) : null}
      </BottomSheet>
    </div>
  )
}

/** The avatar slot: the luggage-adjusted capacity, in mono. */
function CapacityBadge({ capacity }: { capacity: number }) {
  return (
    <span className="figure flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-sm font-semibold text-ink">
      {capacity}
    </span>
  )
}

function SheetRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-rule py-2.5 last:border-b-0">
      <dt className="shrink-0 text-sm text-muted">{label}</dt>
      <dd
        className={
          mono
            ? 'figure min-w-0 text-right text-sm font-medium text-ink'
            : 'min-w-0 text-right text-sm font-medium text-ink'
        }
      >
        {value}
      </dd>
    </div>
  )
}

function vehicleMeta(vehicle: VehicleRow): string {
  const parts = [vehicle.typeName, vehicle.registrationNo, vehicle.driverName]
    .filter((p): p is string => Boolean(p))
  if (vehicle.seatLabel) parts.push(`${vehicle.seatLabel} sticker`)
  return parts.join(' · ')
}

/**
 * Assigned is a passive state, not a warning: a vehicle with a trip on it is
 * the system working. `unavailable` is the one that needs eyes — a vehicle you
 * were counting on that cannot move is a gap in the plan.
 */
function statusMeta(status: string): { label: string; tone: RowTone } {
  if (status === 'assigned') return { label: 'On a trip', tone: 'neutral' }
  if (status === 'unavailable') return { label: 'Unavailable', tone: 'problem' }
  return { label: 'Free', tone: 'done' }
}

export default FleetBoard
