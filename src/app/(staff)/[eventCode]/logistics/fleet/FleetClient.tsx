'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { PageTitle } from '@/components/ui/PageTitle'
import { StatusPill } from '@/components/ui/StatusPill'
import { EmptyState } from '@/components/ui/EmptyState'
import { CarIcon, PlusIcon, ShieldAlertIcon } from '@/components/icons'
import {
  readFleet,
  quickAddVehicles,
  deleteVehicle,
  type FleetData,
  type VehicleRow,
} from '@/lib/actions/fleet'
import { useStableData } from '@/lib/use-stable-data'
import type { StatusTone } from '@/lib/status'
import { traceFetch } from '@/lib/perf'

interface Props {
  eventId: string
}

/**
 * Assigned is the ACTIVE tone, not a warning: a vehicle with a trip on it
 * is the system working. Unavailable is the one that needs eyes — a
 * vehicle you were counting on that cannot move is a gap in the plan.
 */
const STATUS_META: Record<string, { label: string; tone: StatusTone }> = {
  available: { label: 'Available', tone: 'done' },
  assigned: { label: 'Assigned', tone: 'active' },
  unavailable: { label: 'Unavailable', tone: 'attention' },
}

export function FleetClient({ eventId }: Props) {
  const [showAdd, setShowAdd] = useState(false)
  const [quickCounts, setQuickCounts] = useState<Record<string, number>>({})
  const [actionError, setActionError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const { data, loading, error, reload } = useStableData<FleetData>(
    `fleet:${eventId}`,
    () => traceFetch('fleet :: readFleet', () => readFleet(eventId)),
  )

  const handleQuickAdd = async (typeId: string | null) => {
    const count = quickCounts[typeId ?? '__none__'] ?? 1
    if (count < 1) return
    setSaving(true)
    const result = await quickAddVehicles(eventId, typeId, count, null)
    if (result.ok) {
      setQuickCounts((prev) => ({ ...prev, [typeId ?? '__none__']: 0 }))
      await reload()
    } else {
      setActionError(result.error)
    }
    setSaving(false)
  }

  const handleRemove = async (vehicleId: string) => {
    setSaving(true)
    const result = await deleteVehicle(vehicleId)
    if (result.ok) {
      await reload()
    } else {
      setActionError(result.error)
    }
    setSaving(false)
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="h-6 w-24 rounded bg-rule-strong" />
            <div className="mt-1.5 h-4 w-32 rounded bg-rule" />
          </div>
          <div className="h-11 w-20 rounded-xl bg-rule" />
        </div>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rounded-2xl border border-border bg-surface p-4">
            <div className="h-5 w-2/5 rounded bg-rule-strong" />
            <div className="mt-2 h-4 w-1/4 rounded bg-rule" />
            <div className="mt-2 h-4 w-1/3 rounded bg-rule" />
          </div>
        ))}
      </div>
    )
  }

  if (error || !data) {
    return (
      <EmptyState
        icon={<ShieldAlertIcon className="h-7 w-7" />}
        title="Could not load fleet"
        description={error instanceof Error ? error.message : 'Could not load fleet data.'}
        action={<Button onClick={reload}>Retry</Button>}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <PageTitle right={`${data.vehicles.length} on the ground`}>Fleet</PageTitle>
        <Button
          variant="secondary"
          size="md"
          leadingIcon={<PlusIcon className="h-5 w-5" />}
          onClick={() => setShowAdd(!showAdd)}
        >
          {showAdd ? 'Done' : 'Add'}
        </Button>
      </div>

      <p className="text-sm leading-snug text-muted">
        Capacity shown is people carried <span className="text-brand">with luggage</span>, not
        the sticker seat count.
      </p>

      {actionError && (
        <p
          role="alert"
          className="rounded-xl border border-ledger-red/40 bg-red-tint px-3.5 py-3 text-sm text-ledger-red"
        >
          {actionError}
        </p>
      )}

      {/* Quick-add panel */}
      {showAdd && (
        <Card>
          <CardHeader>
            <div>
              <h3 className="font-semibold text-fg">Add vehicles</h3>
              <p className="text-sm text-muted">Set a count for each type, then tap &ldquo;Add&rdquo; — repeat to build the fleet.</p>
            </div>
          </CardHeader>
          <CardBody className="flex flex-col gap-3">
            {data.types.map((type) => (
              <div key={type.id} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg">{type.name}</p>
                  <p className="flex items-center gap-1.5 text-xs text-muted">
                    <span className="font-semibold text-fg">{type.defaultCapacity}</span>
                    {' with luggage'}
                    {type.seatLabel && (
                      <span className="text-subtle">({type.seatLabel})</span>
                    )}
                  </p>
                </div>
                <select
                  value={quickCounts[type.id] ?? 0}
                  onChange={(e) =>
                    setQuickCounts((prev) => ({
                      ...prev,
                      [type.id]: Math.max(0, parseInt(e.target.value, 10) || 0),
                    }))
                  }
                  className="h-9 w-16 rounded-lg border border-border bg-surface px-2 text-sm text-fg"
                >
                  {Array.from({ length: 11 }, (_, i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </select>
                <Button
                  size="md"
                  variant="primary"
                  disabled={(quickCounts[type.id] ?? 0) < 1 || saving}
                  loading={saving}
                  onClick={() => handleQuickAdd(type.id)}
                >
                  Add
                </Button>
              </div>
            ))}

            {/* Custom (no type) */}
            <div className="flex items-center gap-3 border-t border-border pt-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg">Custom</p>
                <p className="text-xs text-muted">No pre-set type</p>
              </div>
              <select
                value={quickCounts['__none__'] ?? 0}
                onChange={(e) =>
                  setQuickCounts((prev) => ({
                    ...prev,
                    __none__: Math.max(0, parseInt(e.target.value, 10) || 0),
                  }))
                }
                className="h-9 w-16 rounded-lg border border-border bg-surface px-2 text-sm text-fg"
              >
                {Array.from({ length: 6 }, (_, i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
              <Button
                size="md"
                variant="primary"
                disabled={(quickCounts['__none__'] ?? 0) < 1 || saving}
                loading={saving}
                onClick={() => handleQuickAdd(null)}
              >
                Add
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Vehicle list */}
      {data.vehicles.length === 0 ? (
        <EmptyState
          icon={<CarIcon className="h-7 w-7" />}
          title="No vehicles yet"
          description="Tap Add to enter the fleet. Default capacities come from the type; you can always override them later."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {data.vehicles.map((v, i) => (
            <VehicleCard
              key={v.id}
              vehicle={v}
              index={i}
              onRemove={() => handleRemove(v.id)}
              removing={saving}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * One vehicle.
 *
 * The registration is set like a numberplate — mono, brass, letter-spaced —
 * because in the car park that string is how a driver is found, not the
 * label. The capacity figure is the luggage-adjusted one and the sticker
 * count is demoted to a struck-through aside: a 20-seater traveller carries
 * 17 people once their suitcases are in, and dispatching to the sticker
 * number is how a family gets left standing at the airport.
 */
function VehicleCard({
  vehicle,
  index,
  onRemove,
  removing,
}: {
  vehicle: VehicleRow
  index: number
  onRemove: () => void
  removing: boolean
}) {
  const status = STATUS_META[vehicle.status] ?? STATUS_META.available

  return (
    <div
      style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
      className="list-fade rounded-xl border border-rule bg-surface p-3.5"
    >
      <div className="flex items-start justify-between gap-2.5">
        <div className="min-w-0">
          <h3 className="text-base leading-snug font-medium text-ink">
            {vehicle.label ?? 'Unnamed'}
          </h3>
          {vehicle.registrationNo ? (
            <p className="mt-1 font-mono text-sm tracking-[0.08em] text-brand">
              {vehicle.registrationNo}
            </p>
          ) : null}
        </div>
        <StatusPill tone={status.tone}>
          {status.label}
        </StatusPill>
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span className="figure text-2xl leading-none font-medium text-ink">
          {vehicle.capacity}
        </span>
        <span className="text-sm text-muted">
          carried <span className="text-brand">with luggage</span>
        </span>
        {vehicle.seatLabel ? (
          <span className="figure ml-auto text-xs text-muted line-through decoration-muted/60">
            {vehicle.seatLabel}
          </span>
        ) : null}
      </div>

      {vehicle.driverName || vehicle.vendorName ? (
        <dl className="mt-3 flex flex-col gap-1.5 border-t border-rule pt-3 text-sm">
          {vehicle.driverName ? (
            <div className="flex gap-2">
              <dt className="eyebrow w-16 shrink-0 pt-0.5">Driver</dt>
              <dd className="min-w-0 text-ink">
                {vehicle.driverName}
                {vehicle.driverMobile ? (
                  <a
                    href={`tel:${vehicle.driverMobile}`}
                    className="tap ml-2 font-mono text-brand active:opacity-70"
                  >
                    {vehicle.driverMobile}
                  </a>
                ) : null}
              </dd>
            </div>
          ) : null}
          {vehicle.vendorName ? (
            <div className="flex gap-2">
              <dt className="eyebrow w-16 shrink-0 pt-0.5">Vendor</dt>
              <dd className="min-w-0 text-ink">
                {vehicle.vendorName}
                {vehicle.rateNote ? (
                  <span className="text-muted"> · {vehicle.rateNote}</span>
                ) : null}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <button
        type="button"
        disabled={removing}
        onClick={onRemove}
        className="tap mt-3 flex min-h-11 w-full items-center justify-center rounded-lg border border-rule-strong font-mono text-xs tracking-eyebrow text-muted uppercase active:bg-surface-2 active:text-ledger-red disabled:opacity-55"
      >
        Remove
      </button>
    </div>
  )
}

