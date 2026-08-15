'use client'

import { useCallback, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { UserIcon } from '@/components/icons'
import {
  assignDriverToVehicle,
  createDriver,
  readDrivers,
  readVehicleAssignments,
  unassignDriver,
  type DriverRow,
  type VehicleAssignmentRow,
} from '@/lib/actions/fleet'
import {
  readDriverPickupSummary,
  sendDriverPickupSummary,
  type DriverPickupSummary,
} from '@/lib/actions/messages'
import { formatMobile } from '@/lib/phone'
import { useStableData } from '@/lib/use-stable-data'

interface Props {
  eventId: string
  vehicles: { id: string; label: string | null }[]
}

interface RosterData {
  drivers: DriverRow[]
  assignments: VehicleAssignmentRow[]
  error: string | null
}

/** Today in the phone's own timezone — the date the desk means by "today". */
function todayIso(): string {
  const now = new Date()
  const off = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - off).toISOString().slice(0, 10)
}

/**
 * The driver roster, and who is driving what today.
 *
 * WHY THIS EXISTS AS A SCREEN AT ALL
 * `drivers` and `vehicle_assignments` shipped with the fleet migration, with
 * server actions written against them, and nothing ever rendered either one.
 * The tables were live and unreachable: no way to add a driver, no way to say
 * who has which car today, and so the pickup summary (which needs a driver's
 * mobile) could never have anything to send.
 *
 * Assignment is per DAY on purpose — drivers swap cars between days, and the
 * unique indexes enforce one car per driver per day in both directions. The
 * per-vehicle `driver_name` column on `vehicles` is a different thing: the
 * vendor's default driver, not today's roster.
 */
export function DriverRoster({ eventId, vehicles }: Props) {
  const [date, setDate] = useState(todayIso)
  const [showAdd, setShowAdd] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // New-driver form
  const [fullName, setFullName] = useState('')
  const [mobile, setMobile] = useState('')

  // Assignment form
  const [assignVehicleId, setAssignVehicleId] = useState('')
  const [assignDriverId, setAssignDriverId] = useState('')

  // Pickup summary (§4.4): preview held for one driver at a time.
  const [summary, setSummary] = useState<{
    driverId: string
    summary: DriverPickupSummary
  } | null>(null)
  const [sentFor, setSentFor] = useState<string | null>(null)

  const load = useCallback(async (): Promise<RosterData> => {
    const [driverRes, assignRes] = await Promise.all([
      readDrivers(eventId),
      readVehicleAssignments(eventId, date),
    ])
    return {
      drivers: driverRes.ok ? driverRes.rows : [],
      assignments: assignRes.ok ? assignRes.rows : [],
      error: driverRes.ok ? (assignRes.ok ? null : assignRes.error) : driverRes.error,
    }
  }, [eventId, date])

  const { data, loading, reload } = useStableData<RosterData>(
    `fleet-drivers:${eventId}:${date}`,
    load,
  )

  async function handleAddDriver(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setActionError(null)
    const result = await createDriver({
      eventId,
      fullName,
      mobile: mobile || undefined,
    })
    if (result.ok) {
      setFullName('')
      setMobile('')
      setShowAdd(false)
      await reload()
    } else {
      setActionError(result.error)
    }
    setBusy(false)
  }

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setActionError(null)
    const result = await assignDriverToVehicle({
      eventId,
      vehicleId: assignVehicleId,
      driverId: assignDriverId,
      assignDate: date,
    })
    if (result.ok) {
      setAssignVehicleId('')
      setAssignDriverId('')
      await reload()
    } else {
      setActionError(result.error)
    }
    setBusy(false)
  }

  /**
   * §4.4 — a driver's pickups for the day, previewed before anything is
   * queued. Preview first, send second, on purpose: the same
   * propose-then-a-human-commits shape the rest of the app uses, and the
   * cheapest place to notice that a driver has the wrong car for the day.
   */
  async function handlePreview(driverId: string) {
    setBusy(true)
    setActionError(null)
    setSentFor(null)
    const res = await readDriverPickupSummary(eventId, driverId, date)
    if (res.ok) {
      setSummary({ driverId, summary: res.summary })
    } else {
      setSummary(null)
      setActionError(res.error)
    }
    setBusy(false)
  }

  async function handleSend(driverId: string) {
    setBusy(true)
    setActionError(null)
    const res = await sendDriverPickupSummary(eventId, driverId, date)
    if (res.ok) {
      setSentFor(driverId)
      setSummary(null)
    } else {
      setActionError(res.error)
    }
    setBusy(false)
  }

  async function handleUnassign(assignmentId: string) {
    setBusy(true)
    setActionError(null)
    const result = await unassignDriver(assignmentId)
    if (result.ok) {
      await reload()
    } else {
      setActionError(result.error)
    }
    setBusy(false)
  }

  const drivers = data?.drivers ?? []
  const assignments = data?.assignments ?? []

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-fg">Drivers</h3>
            <p className="text-sm text-muted">
              Who is driving what, for one day. Drivers swap cars — this is the
              record of today, not of the vehicle.
            </p>
          </div>
          <Button variant="secondary" size="md" onClick={() => setShowAdd(!showAdd)}>
            {showAdd ? 'Done' : 'Add driver'}
          </Button>
        </div>
      </CardHeader>
      <CardBody>
        <div className="flex flex-col gap-4">
          {actionError && (
            <p
              role="alert"
              className="rounded-xl border border-ledger-red/40 bg-red-tint px-3.5 py-3 text-sm text-ledger-red"
            >
              {actionError}
            </p>
          )}
          {data?.error && !actionError ? (
            <p
              role="alert"
              className="rounded-xl border border-ledger-red/40 bg-red-tint px-3.5 py-3 text-sm text-ledger-red"
            >
              {data.error}
            </p>
          ) : null}

          {showAdd && (
            <form onSubmit={handleAddDriver} className="flex flex-col gap-3">
              <Input
                label="Driver name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
              />
              <Input
                label="Mobile"
                type="tel"
                inputMode="tel"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                hint="10 digits. Anything with +91 or spaces is normalised on save."
              />
              <Button type="submit" size="lg" fullWidth disabled={!fullName || busy} loading={busy}>
                Save driver
              </Button>
            </form>
          )}

          <Input
            label="Date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />

          {/* Assign a driver to a car for the selected day. */}
          {drivers.length > 0 && vehicles.length > 0 ? (
            <form onSubmit={handleAssign} className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <Select
                  label="Vehicle"
                  value={assignVehicleId}
                  onChange={(e) => setAssignVehicleId(e.target.value)}
                >
                  <option value="">Select…</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label ?? 'Unnamed'}
                    </option>
                  ))}
                </Select>
                <Select
                  label="Driver"
                  value={assignDriverId}
                  onChange={(e) => setAssignDriverId(e.target.value)}
                >
                  <option value="">Select…</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.fullName}
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                type="submit"
                variant="secondary"
                size="lg"
                fullWidth
                disabled={!assignVehicleId || !assignDriverId || busy}
                loading={busy}
              >
                Assign for this day
              </Button>
            </form>
          ) : null}

          {/* Today's pairings */}
          {loading ? (
            <div className="h-16 rounded-lg bg-surface-2" />
          ) : assignments.length === 0 ? (
            <p className="text-sm text-muted">No cars assigned for this date yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {assignments.map((a) => (
                <li key={a.id} className="rounded-lg bg-surface-2 p-2.5 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-ink">
                        {a.vehicleLabel ?? 'Unnamed'} · {a.driverName}
                      </p>
                      {a.driverMobile ? (
                        <a
                          href={`tel:${a.driverMobile}`}
                          className="tap font-mono text-brand active:opacity-70"
                        >
                          {formatMobile(a.driverMobile)}
                        </a>
                      ) : (
                        <span className="text-muted">No mobile on file</span>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handlePreview(a.driverId)}
                        className="tap min-h-11 rounded-lg border border-rule-strong px-3 font-mono text-xs tracking-eyebrow text-muted uppercase active:bg-surface active:text-brand disabled:opacity-55"
                      >
                        Pickups
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleUnassign(a.id)}
                        className="tap min-h-11 rounded-lg border border-rule-strong px-3 font-mono text-xs tracking-eyebrow text-muted uppercase active:bg-surface active:text-ledger-red disabled:opacity-55"
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  {sentFor === a.driverId ? (
                    <p className="mt-2.5 border-t border-rule pt-2.5 text-sm text-muted">
                      Queued in the message log for {formatMobile(a.driverMobile)}.
                    </p>
                  ) : null}

                  {summary?.driverId === a.driverId ? (
                    <div className="mt-2.5 border-t border-rule pt-2.5">
                      {summary.summary.pickups.length === 0 ? (
                        <p className="text-muted">
                          No committed pickups for this driver on this date. Commit a
                          trip on the arrivals or departures board first.
                        </p>
                      ) : (
                        <>
                          <ul className="flex flex-col gap-1">
                            {summary.summary.pickups.map((p, i) => (
                              <li key={i} className="flex gap-2 text-ink">
                                <span className="font-mono text-muted">{p.time ?? '—'}</span>
                                <span className="min-w-0">
                                  {p.headName} ({p.pax})
                                  {p.point ? <span className="text-muted"> · {p.point}</span> : null}
                                </span>
                              </li>
                            ))}
                          </ul>
                          <p className="mt-1.5 text-muted">
                            {summary.summary.totalPax} guests in total.
                          </p>
                          <Button
                            variant="secondary"
                            size="md"
                            fullWidth
                            className="mt-2.5"
                            disabled={busy || !a.driverMobile}
                            loading={busy}
                            onClick={() => handleSend(a.driverId)}
                          >
                            {a.driverMobile ? 'Queue message to driver' : 'No mobile on file'}
                          </Button>
                        </>
                      )}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {/* Roster */}
          {!loading && drivers.length === 0 ? (
            <EmptyState
              icon={<UserIcon className="h-7 w-7" />}
              title="No drivers yet"
              description="Add the drivers on the ground, then pair each one with a car for the day."
            />
          ) : null}
        </div>
      </CardBody>
    </Card>
  )
}
