'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/Button'
import { quickAddVehicles, type VehicleTypeRow } from '@/lib/actions/fleet'

export interface QuickAddVehiclesProps {
  eventId: string
  types: VehicleTypeRow[]
  /** Called after a successful add so the parent can refetch its own view. */
  onAdded: () => void | Promise<void>
  /** Rows offered for a typed vehicle. Custom is always 0–5. */
  maxPerType?: number
}

/**
 * The one add-vehicle form in the app.
 *
 * Extracted from FleetClient so the departures screen can offer the same
 * affordance without a second implementation. A duplicated add form is the
 * kind of thing that stays in sync for a week and then quietly doesn't —
 * and the failure mode here is a vehicle created with the wrong capacity,
 * which strands a family at the airport.
 *
 * Capacity is never passed: `quickAddVehicles(…, capacityOverride: null)`
 * resolves it from `vehicle_types.default_capacity`, which is the
 * luggage-adjusted figure. Do not "helpfully" send the sticker seat count.
 */
export function QuickAddVehicles({
  eventId,
  types,
  onAdded,
  maxPerType = 10,
}: QuickAddVehiclesProps) {
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleAdd = async (typeId: string | null) => {
    const key = typeId ?? '__none__'
    const count = counts[key] ?? 0
    if (count < 1) return

    setSaving(true)
    setError(null)
    const result = await quickAddVehicles(eventId, typeId, count, null)
    if (result.ok) {
      setCounts((prev) => ({ ...prev, [key]: 0 }))
      await onAdded()
    } else {
      setError(result.error)
    }
    setSaving(false)
  }

  const setCount = (key: string, raw: string) =>
    setCounts((prev) => ({ ...prev, [key]: Math.max(0, parseInt(raw, 10) || 0) }))

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-ledger-red/40 bg-red-tint px-3.5 py-3 text-sm text-ledger-red"
        >
          {error}
        </p>
      )}

      {types.map((type) => (
        <div key={type.id} className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-fg">{type.name}</p>
            <p className="flex items-center gap-1.5 text-xs text-muted">
              <span className="font-semibold text-fg">{type.defaultCapacity}</span>
              {' with luggage'}
              {type.seatLabel && <span className="text-subtle">({type.seatLabel})</span>}
            </p>
          </div>
          <select
            aria-label={`How many ${type.name}`}
            value={counts[type.id] ?? 0}
            onChange={(e) => setCount(type.id, e.target.value)}
            className="h-9 w-16 rounded-lg border border-border bg-surface px-2 text-sm text-fg"
          >
            {Array.from({ length: maxPerType + 1 }, (_, i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
          <Button
            size="md"
            variant="primary"
            disabled={(counts[type.id] ?? 0) < 1 || saving}
            loading={saving}
            onClick={() => handleAdd(type.id)}
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
          aria-label="How many custom vehicles"
          value={counts.__none__ ?? 0}
          onChange={(e) => setCount('__none__', e.target.value)}
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
          disabled={(counts.__none__ ?? 0) < 1 || saving}
          loading={saving}
          onClick={() => handleAdd(null)}
        >
          Add
        </Button>
      </div>
    </div>
  )
}

export default QuickAddVehicles
