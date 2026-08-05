'use client'

import { useState, useCallback, useRef } from 'react'

import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Spinner } from '@/components/ui/Spinner'
import { LinkButton } from '@/components/ui/LinkButton'
import { BuildingIcon, CheckCircleIcon } from '@/components/icons'
import {
  searchDepartureGroups,
  saveDeparture,
  type DepartureGroup,
  type DepartureInput,
} from '@/lib/actions/departures'

interface Props {
  eventId: string
  eventCode: string
}

type Phase =
  | { stage: 'idle' }
  | { stage: 'searching' }
  | { stage: 'results'; groups: DepartureGroup[] }
  | { stage: 'form'; group: DepartureGroup; error: string | null; saving: boolean; saved: boolean }
  | { stage: 'error'; message: string }

const MODES = [
  { value: 'air', label: 'Air' },
  { value: 'train', label: 'Train' },
  { value: 'bus', label: 'Bus' },
  { value: 'cab', label: 'Cab' },
  { value: 'self_drive', label: 'Self drive' },
] as const

const SOURCE_LABELS: Record<string, string> = {
  rsvp_call: 'From RSVP call',
  event_team: 'Updated by team',
}

export function DeparturesClient({ eventId, eventCode }: Props) {
  const [phase, setPhase] = useState<Phase>({ stage: 'idle' })
  const [searchTerm, setSearchTerm] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  // Form fields
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [mode, setMode] = useState<string>('cab')
  const [reference, setReference] = useState('')
  const [dropPoint, setDropPoint] = useState('')
  const [pax, setPax] = useState<number>(0)
  // Cab expense
  const [expenseAmount, setExpenseAmount] = useState<number | ''>('')
  const [expenseMode, setExpenseMode] = useState<string>('')
  const [expenseNotes, setExpenseNotes] = useState('')

  const openForm = useCallback((group: DepartureGroup) => {
    setPax(group.existingLeg?.paxOnLeg ?? group.pax)
    setDate(group.existingLeg?.travelDate ?? '')
    setTime(group.existingLeg?.travelTime ?? '')
    setMode(group.existingLeg?.mode ?? 'cab')
    setReference(group.existingLeg?.reference ?? '')
    setDropPoint(group.existingLeg?.point ?? '')
    setExpenseAmount('')
    setExpenseMode('')
    setExpenseNotes('')
    setPhase({ stage: 'form', group, error: null, saving: false, saved: false })
  }, [])

  const handleSearch = useCallback(async () => {
    if (!searchTerm.trim()) return
    setPhase({ stage: 'searching' })
    try {
      const groups = await searchDepartureGroups(eventId, searchTerm.trim())
      if (groups.length === 0) {
        setPhase({ stage: 'idle' })
        return
      }
      if (groups.length === 1) {
        openForm(groups[0])
        return
      }
      setPhase({ stage: 'results', groups })
    } catch {
      setPhase({ stage: 'error', message: 'Search failed.' })
    }
  }, [eventId, searchTerm, openForm])

  const handleSave = async () => {
    if (phase.stage !== 'form') return

    // Validate
    if (!date) {
      setPhase({ ...phase, error: 'Date is required.' })
      return
    }
    if (!time) {
      setPhase({ ...phase, error: 'Time is required.' })
      return
    }
    if (pax <= 0) {
      setPhase({ ...phase, error: 'PAX must be positive.' })
      return
    }

    setPhase({ ...phase, saving: true, error: null })

    const result = await saveDeparture({
      eventId,
      groupId: phase.group.groupId,
      travelDate: date,
      travelTime: time,
      mode: mode as DepartureInput['mode'],
      reference: reference || undefined,
      dropPoint: dropPoint || undefined,
      paxOnLeg: pax,
      expenseAmount: mode === 'cab' && expenseAmount !== '' ? Number(expenseAmount) : undefined,
      expenseMode: mode === 'cab' && expenseMode ? (expenseMode as DepartureInput['expenseMode']) : undefined,
      expenseNotes: mode === 'cab' && expenseNotes ? expenseNotes : undefined,
      existingLegId: phase.group.existingLeg?.id ?? null,
    })

    if (result.ok) {
      setPhase({ stage: 'form', group: phase.group, error: null, saving: false, saved: true })
    } else {
      setPhase({ ...phase, saving: false, error: result.error })
    }
  }

  if (phase.stage === 'error') {
    return (
      <EmptyState
        icon={<BuildingIcon className="h-7 w-7" />}
        title="Search failed"
        description={phase.message}
        action={<Button onClick={() => setPhase({ stage: 'idle' })}>Try again</Button>}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold text-fg">Departures</h2>
        <p className="mt-0.5 text-sm text-muted">
          Record a walk-up departure. Search by family head name or room number.
        </p>
      </div>

      {/* Search bar */}
      {phase.stage === 'idle' && (
        <div className="flex gap-2">
          <input
            ref={searchRef}
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Search by name or room number"
            className="flex-1 rounded-xl border border-border bg-surface px-4 py-3 text-base text-fg placeholder:text-subtle"
            autoFocus
          />
          <Button variant="primary" onClick={handleSearch} disabled={!searchTerm.trim()}>
            Search
          </Button>
        </div>
      )}

      {phase.stage === 'searching' && (
        <div className="flex min-h-[30vh] items-center justify-center">
          <Spinner size="md" />
        </div>
      )}

      {/* Search results */}
      {phase.stage === 'results' && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">{phase.groups.length} match{phase.groups.length !== 1 ? 'es' : ''} — tap one to open.</p>
          {phase.groups.map((g) => (
            <button
              key={g.groupId}
              type="button"
              onClick={() => openForm(g)}
              className="tap w-full rounded-xl border border-border bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-2"
            >
              <p className="font-semibold text-fg">{g.headName}</p>
              <p className="text-sm text-muted">
                {g.roomNumber
                  ? `Room ${g.roomNumber}${g.hotelName ? ` · ${g.hotelName}` : ''} · `
                  : ''}
                {g.pax} PAX
                {g.existingLeg ? ` · ${SOURCE_LABELS[g.existingLeg.source] ?? g.existingLeg.source}` : ''}
              </p>
            </button>
          ))}
        </div>
      )}

      {/* Departure form */}
      {phase.stage === 'form' && (
        <>
          {/* Existing leg notice */}
          {phase.group.existingLeg && (
            <Card>
              <CardBody>
                <p className="text-sm text-muted">
                  <span className="font-medium text-warning">Existing departure:</span>{' '}
                  {phase.group.existingLeg.mode} on {phase.group.existingLeg.travelDate} at{' '}
                  {phase.group.existingLeg.travelTime}
                  {phase.group.existingLeg.point ? ` · ${phase.group.existingLeg.point}` : ''}
                </p>
                <p className="mt-1 text-xs text-subtle">
                  {SOURCE_LABELS[phase.group.existingLeg.source] ?? phase.group.existingLeg.source}.
                  Updating now — the newer human entry wins.
                </p>
              </CardBody>
            </Card>
          )}

          {phase.error && (
            <div className="rounded-xl border border-tint-danger bg-tint-danger px-4 py-3 text-sm text-danger">
              {phase.error}
            </div>
          )}

          <Card>
            <CardBody className="flex flex-col gap-4">
              <h3 className="font-semibold text-fg">{phase.group.headName}</h3>

              <div className="flex gap-3">
                <label className="flex-1">
                  <span className="block text-sm font-medium text-fg">Date</span>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-fg text-base"
                  />
                </label>
                <label className="flex-1">
                  <span className="block text-sm font-medium text-fg">Time</span>
                  <input
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-fg text-base"
                  />
                </label>
              </div>

              <label>
                <span className="block text-sm font-medium text-fg">Mode</span>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-fg text-base"
                >
                  {MODES.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </label>

              <label>
                <span className="block text-sm font-medium text-fg">Reference (flight/train/PNR)</span>
                <input
                  type="text"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-fg text-base placeholder:text-subtle"
                  placeholder="Optional"
                />
              </label>

              <label>
                <span className="block text-sm font-medium text-fg">Drop point</span>
                <input
                  type="text"
                  value={dropPoint}
                  onChange={(e) => setDropPoint(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-fg text-base placeholder:text-subtle"
                  placeholder="Airport, station, or landmark"
                />
              </label>

              <label>
                <span className="block text-sm font-medium text-fg">PAX on this leg</span>
                <input
                  type="number"
                  value={pax}
                  onChange={(e) => setPax(Math.max(0, parseInt(e.target.value, 10) || 0))}
                  min={1}
                  className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-fg text-base"
                />
              </label>

              {/* Cab expense section */}
              {mode === 'cab' && (
                <div className="flex flex-col gap-3 rounded-lg border border-tint-warning bg-surface-2 p-3">
                  <h4 className="text-sm font-semibold text-warning">Cab expense</h4>
                  <label>
                    <span className="block text-sm font-medium text-fg">Amount (₹)</span>
                    <input
                      type="number"
                      value={expenseAmount}
                      onChange={(e) =>
                        setExpenseAmount(
                          e.target.value === '' ? '' : Math.max(0, parseFloat(e.target.value)),
                        )
                      }
                      min={0}
                      step={1}
                      className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-fg text-base"
                      placeholder="e.g. 500"
                    />
                  </label>
                  <label>
                    <span className="block text-sm font-medium text-fg">Payment mode</span>
                    <select
                      value={expenseMode}
                      onChange={(e) => setExpenseMode(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-fg text-base"
                    >
                      <option value="">Select</option>
                      <option value="cash">Cash</option>
                      <option value="upi">UPI</option>
                      <option value="vendor_bill">Vendor bill</option>
                    </select>
                  </label>
                  <label>
                    <span className="block text-sm font-medium text-fg">Notes</span>
                    <input
                      type="text"
                      value={expenseNotes}
                      onChange={(e) => setExpenseNotes(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-fg text-base placeholder:text-subtle"
                      placeholder="Optional"
                    />
                  </label>
                </div>
              )}

              <div className="flex gap-3">
                <Button
                  fullWidth
                  onClick={handleSave}
                  loading={phase.saving}
                  disabled={phase.saved}
                >
                  {phase.saved ? 'Saved' : 'Save departure'}
                </Button>
                <Button
                  variant="ghost"
                  fullWidth
                  onClick={() => setPhase({ stage: 'idle' })}
                >
                  {phase.saved ? 'New search' : 'Cancel'}
                </Button>
              </div>

              {phase.saved && (
                <LinkButton
                  fullWidth
                  variant="secondary"
                  href={`/${eventCode}/logistics`}
                  trailingIcon={<CheckCircleIcon className="h-5 w-5" />}
                >
                  Arrange a vehicle
                </LinkButton>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  )
}
