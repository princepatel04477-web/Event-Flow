'use client'

import { useState, useEffect, useCallback } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Spinner } from '@/components/ui/Spinner'
import { CarIcon, PlusIcon, ShieldAlertIcon } from '@/components/icons'
import {
  readFleet,
  quickAddVehicles,
  deleteVehicle,
  type FleetData,
  type VehicleRow,
} from '@/lib/actions/fleet'

interface Props {
  eventId: string
}

type Phase =
  | { stage: 'loading' }
  | { stage: 'ready'; data: FleetData; actionError: string | null }
  | { stage: 'error'; message: string }

const STATUS_META: Record<string, { label: string; tone: 'success' | 'warning' | 'neutral' }> = {
  available: { label: 'Available', tone: 'success' },
  assigned: { label: 'Assigned', tone: 'warning' },
  unavailable: { label: 'Unavailable', tone: 'neutral' },
}

export function FleetClient({ eventId }: Props) {
  const [phase, setPhase] = useState<Phase>({ stage: 'loading' })
  const [showAdd, setShowAdd] = useState(false)
  const [quickCounts, setQuickCounts] = useState<Record<string, number>>({})
  const [actionError, setActionError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setPhase({ stage: 'loading' })
    try {
      const data = await readFleet(eventId)
      setPhase({ stage: 'ready', data, actionError: null })
    } catch {
      setPhase({ stage: 'error', message: 'Could not load fleet data.' })
    }
  }, [eventId])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  const handleQuickAdd = async (typeId: string | null) => {
    const count = quickCounts[typeId ?? '__none__'] ?? 1
    if (count < 1) return
    setSaving(true)
    const result = await quickAddVehicles(eventId, typeId, count, null)
    if (result.ok) {
      setQuickCounts((prev) => ({ ...prev, [typeId ?? '__none__']: 0 }))
      await load()
    } else {
      setActionError(result.error)
    }
    setSaving(false)
  }

  const handleRemove = async (vehicleId: string) => {
    setSaving(true)
    const result = await deleteVehicle(vehicleId)
    if (result.ok) {
      await load()
    } else {
      setActionError(result.error)
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
        title="Could not load fleet"
        description={phase.message}
        action={<Button onClick={load}>Retry</Button>}
      />
    )
  }

  const { data } = phase

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-fg">Fleet</h2>
          <p className="mt-0.5 text-sm text-muted">
            {data.vehicles.length} vehicle{data.vehicles.length !== 1 ? 's' : ''} on the ground
          </p>
        </div>
        <Button
          variant="secondary"
          size="md"
          leadingIcon={<PlusIcon className="h-5 w-5" />}
          onClick={() => setShowAdd(!showAdd)}
        >
          {showAdd ? 'Done' : 'Add'}
        </Button>
      </div>

      {actionError && (
        <div className="rounded-xl border border-tint-danger bg-tint-danger px-4 py-3 text-sm text-danger">
          {actionError}
        </div>
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
          {data.vehicles.map((v) => (
            <VehicleCard
              key={v.id}
              vehicle={v}
              onRemove={() => handleRemove(v.id)}
              removing={saving}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function VehicleCard({
  vehicle,
  onRemove,
  removing,
}: {
  vehicle: VehicleRow
  onRemove: () => void
  removing: boolean
}) {
  const status = STATUS_META[vehicle.status] ?? STATUS_META.available

  return (
    <Card>
      <CardBody>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              <h3 className="font-semibold text-fg">{vehicle.label ?? 'Unnamed'}</h3>
              <Badge tone={status.tone} size="sm">
                {status.label}
              </Badge>
            </div>

            <div className="flex flex-col gap-0.5">
              <p className="flex items-center gap-1.5 text-sm text-fg">
                <span className="font-semibold tabular-nums">{vehicle.capacity}</span>
                <span className="text-muted">with luggage</span>
                {vehicle.seatLabel && (
                  <span className="text-subtle text-xs">({vehicle.seatLabel})</span>
                )}
              </p>

              {vehicle.driverName && (
                <p className="text-sm text-muted">
                  Driver: {vehicle.driverName}
                  {vehicle.driverMobile ? ` · ${vehicle.driverMobile}` : ''}
                </p>
              )}

              {vehicle.vendorName && (
                <p className="text-sm text-muted">
                  Vendor: {vehicle.vendorName}
                  {vehicle.rateNote ? ` · ${vehicle.rateNote}` : ''}
                </p>
              )}

              {vehicle.registrationNo && (
                <p className="text-xs text-subtle">{vehicle.registrationNo}</p>
              )}
            </div>
          </div>

          <button
            type="button"
            disabled={removing}
            onClick={onRemove}
            className="tap shrink-0 rounded-lg px-2 py-1 text-xs text-muted hover:text-danger disabled:opacity-55"
          >
            Remove
          </button>
        </div>
      </CardBody>
    </Card>
  )
}

