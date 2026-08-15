'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
import {
  createOdometerLog,
  readOdometerLogs,
  type OdometerRow,
} from '@/lib/actions/fleet'

interface Props {
  eventId: string
  vehicles: { id: string; label: string | null }[]
  onSaved: () => void | Promise<void>
}

/**
 * Manual per-day odometer entry (§3.3) — the event team's exact field list:
 * Car No, Plate No, Driver No, Starting KMS, Ending KMS, Starting Time,
 * Ending Time. Entered per vehicle, per day.
 *
 * Validation mirrors the DB CHECK constraints (end_km >= start_km) — no
 * invented rules. Server clock owns recorded_at; nothing here sends a
 * timestamp.
 */
export function OdometerEntry({ eventId, vehicles, onSaved }: Props) {
  const [vehicleId, setVehicleId] = useState('')
  const [logDate, setLogDate] = useState('')
  const [startKm, setStartKm] = useState('')
  const [endKm, setEndKm] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const kmError =
    startKm !== '' && endKm !== '' && Number(endKm) < Number(startKm)
      ? 'Ending KMS must not be less than Starting KMS.'
      : null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (kmError) return
    setSaving(true)
    setError(null)

    const result = await createOdometerLog({
      eventId,
      vehicleId,
      logDate,
      startKm: Number(startKm),
      endKm: Number(endKm),
      startTime: startTime || undefined,
      endTime: endTime || undefined,
      notes: notes || undefined,
    })

    if (result.ok) {
      setStartKm('')
      setEndKm('')
      setStartTime('')
      setEndTime('')
      setNotes('')
      await onSaved()
    } else {
      setError(result.error)
    }
    setSaving(false)
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <h3 className="font-semibold text-fg">Daily KM entry</h3>
          <p className="text-sm text-muted">
            One row per vehicle per day. The server stamps the time — a phone
            clock can&apos;t backdate a reading.
          </p>
        </div>
      </CardHeader>
      <CardBody>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Select
            label="Vehicle"
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
            required
            error={error && !vehicleId ? error : null}
          >
            <option value="">Select a vehicle…</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label ?? 'Unnamed'}
              </option>
            ))}
          </Select>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Date"
              type="date"
              value={logDate}
              onChange={(e) => setLogDate(e.target.value)}
              required
            />
            <Input
              label="Starting KMS"
              type="number"
              inputMode="numeric"
              min={0}
              value={startKm}
              onChange={(e) => setStartKm(e.target.value)}
              required
            />
            <Input
              label="Ending KMS"
              type="number"
              inputMode="numeric"
              min={0}
              value={endKm}
              onChange={(e) => setEndKm(e.target.value)}
              required
              error={kmError}
            />
            <Input
              label="Starting Time"
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
            <Input
              label="Ending Time"
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </div>

          <Textarea
            label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Fuel top-up, delay, anything the desk should know"
            rows={2}
          />

          {error && !kmError ? (
            <p
              role="alert"
              className="rounded-xl border border-ledger-red/40 bg-red-tint px-3.5 py-3 text-sm text-ledger-red"
            >
              {error}
            </p>
          ) : null}

          <Button
            type="submit"
            size="lg"
            fullWidth
            disabled={!vehicleId || !logDate || startKm === '' || endKm === '' || Boolean(kmError) || saving}
            loading={saving}
          >
            Save reading
          </Button>
        </form>
      </CardBody>
    </Card>
  )
}

export function OdometerRecent({ eventId }: { eventId: string }) {
  const [rows, setRows] = useState<OdometerRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  async function load() {
    const res = await readOdometerLogs(eventId)
    if (res.ok) {
      setRows(res.rows.slice(0, 5))
      setError(null)
    } else {
      setError(res.error)
    }
    setLoaded(true)
  }

  if (!loaded) {
    void load()
    return null
  }

  if (error) return null
  if (!rows || rows.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <div>
          <h3 className="font-semibold text-fg">Recent readings</h3>
        </div>
      </CardHeader>
      <CardBody>
        <ul className="flex flex-col gap-2">
          {rows.map((r) => (
            <li key={r.id} className="flex items-baseline justify-between gap-3 rounded-lg bg-surface-2 p-2.5 text-sm">
              <span className="min-w-0 font-medium text-ink">{r.vehicleLabel ?? 'Unnamed'}</span>
              <span className="shrink-0 font-mono text-muted">
                {r.logDate} · {r.startKm}→{r.endKm} km
              </span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  )
}
