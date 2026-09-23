'use client'

import { useState } from 'react'

import { CarIcon, ChevronDownIcon, ChevronRightIcon, MinusIcon, PlaneIcon, PlusIcon } from '@/components/icons'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import {
  ARRIVAL_TIME_SLOTS,
  TRAVEL_MODE_CHIPS,
  arrivalDateChipToValue,
  arrivalTimeChipToValue,
  buildRsvpLogPayload,
  defaultDepartureDate,
  getArrivalDateChips,
  travelModeChipToValue,
  type ArrivalTimeSlotId,
  type RsvpLogFormValues,
  type TravelModeChipId,
} from '@/lib/rsvp-log'
import { cn } from '@/lib/utils'

import { BusIcon, TrainIcon } from './TravelIcons'
import type { FamilyRow, OutcomeStatus } from './types'

interface InlineCaptureStepProps {
  status: OutcomeStatus
  family: FamilyRow | null
  expectedPax: number
  startsOn?: string | null
  endsOn?: string | null
  onSave: (values: RsvpLogFormValues) => void
  onCancel: () => void
  isSaving?: boolean
}

export function InlineCaptureStep({
  status,
  family,
  expectedPax,
  startsOn,
  endsOn,
  onSave,
  onCancel,
  isSaving = false,
}: InlineCaptureStepProps) {
  // Steppers: prefilled from expected pax or existing family row
  const initialAdults = family?.adults_confirmed ?? Math.max(expectedPax || 1, 1)
  const initialChildren = family?.children_confirmed ?? 0
  const [adults, setAdults] = useState<number>(initialAdults)
  const [children, setChildren] = useState<number>(initialChildren)

  // Arrival date: chips for event days (-2...+1 around event start) + "Other date"
  const dateChips = getArrivalDateChips(startsOn)
  const [dateChipId, setDateChipId] = useState<string>('day_0')
  const [customArrivalDate, setCustomArrivalDate] = useState<string>('')

  // Arrival time: chips Morning / Afternoon / Evening / Night + optional exact time
  const [timeSlotId, setTimeSlotId] = useState<ArrivalTimeSlotId | 'custom'>('morning')
  const [customArrivalTime, setCustomArrivalTime] = useState<string>('')

  // Travel Mode: 4 big choices (Train, Flight, Bus, By road)
  const [modeChipId, setModeChipId] = useState<TravelModeChipId>('train')
  const [flightTrainNo, setFlightTrainNo] = useState<string>('')

  // Pickup toggle
  const [needsPickup, setNeedsPickup] = useState<boolean>(family?.needs_pickup ?? false)

  // Departure: default "Same as event end" with Edit
  const defaultDepDate = defaultDepartureDate(startsOn, endsOn)
  const [departureDate, setDepartureDate] = useState<string>(defaultDepDate)
  const [departureTime, setDepartureTime] = useState<string>('')
  const [departureMode, setDepartureMode] = useState<string>('')
  const [showDepartureEdit, setShowDepartureEdit] = useState<boolean>(false)

  // Notes optional
  const [notes, setNotes] = useState<string>(family?.remarks ?? '')

  const totalGuests = adults + children
  const isConfirmed = status === 'confirmed'

  function handleSubmit() {
    if (totalGuests < 1) return

    const actualArrivalDate = arrivalDateChipToValue(dateChipId, startsOn, customArrivalDate)
    const actualArrivalTime = arrivalTimeChipToValue(timeSlotId, customArrivalTime)
    const actualTravelMode = travelModeChipToValue(modeChipId)

    const payload = buildRsvpLogPayload({
      rsvpStatus: status,
      adultsCount: adults,
      childrenCount: children,
      arrivalDate: actualArrivalDate,
      arrivalTime: actualArrivalTime,
      travelMode: actualTravelMode,
      flightTrainNo: flightTrainNo.trim() ? flightTrainNo.trim() : undefined,
      needsPickup,
      departureDate: departureDate || undefined,
      departureTime: departureTime || undefined,
      departureMode: departureMode ? travelModeChipToValue(departureMode) : undefined,
      notes: notes.trim() ? notes.trim() : undefined,
    })

    onSave(payload)
  }

  return (
    <div
      className="flex flex-col gap-4 rounded-2xl border-2 border-brand/35 bg-surface p-4 shadow-e2 transition-all animate-in fade-in slide-in-from-top-2 duration-200"
      role="region"
      aria-label="Capture RSVP travel details"
    >
      <div className="flex items-center justify-between border-b border-rule pb-2.5">
        <div>
          <h3 className="text-lg font-bold text-ink">
            {isConfirmed ? 'Capture arrival & guests' : 'Tentative details'}
          </h3>
          <p className="text-xs text-muted">
            {isConfirmed ? 'They are coming! Record travel details below.' : 'Marking as maybe. Record what they know.'}
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs font-semibold text-muted underline hover:text-ink active:text-brand"
        >
          Cancel
        </button>
      </div>

      {/* 1. How many coming: Adults + Children steppers */}
      <div className="flex flex-col gap-2.5">
        <label className="text-xs font-bold uppercase tracking-wider text-muted">
          How many guests?
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Stepper label="Adults" value={adults} onChange={setAdults} min={0} />
          <Stepper label="Children" value={children} onChange={setChildren} min={0} />
        </div>
        <div className="flex items-center justify-between">
          <p className="figure text-xs font-medium text-muted">
            {totalGuests} {totalGuests === 1 ? 'guest' : 'guests'} total
            {expectedPax ? ` (expected ${expectedPax})` : ''}
          </p>
          {totalGuests < 1 ? (
            <p role="alert" className="text-xs font-medium text-ledger-red">
              Add at least 1 guest
            </p>
          ) : null}
        </div>
      </div>

      {/* 2. Arrival date: chips for event days (-2...+1) + Other date */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-bold uppercase tracking-wider text-muted">
          Arrival date
        </label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Arrival date options">
          {dateChips.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setDateChipId(c.id)}
              className={cn(
                'tap flex flex-col items-center justify-center rounded-xl border px-3 py-2 text-xs font-semibold leading-tight min-h-12 min-w-16',
                dateChipId === c.id
                  ? 'border-brand bg-brand-tint text-brand ring-2 ring-brand/30'
                  : 'border-rule-strong bg-surface text-ink active:bg-surface-2',
              )}
            >
              <span>{c.label}</span>
              <span className="text-[10px] font-normal text-muted">{c.sublabel}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setDateChipId('other')}
            className={cn(
              'tap flex items-center justify-center rounded-xl border px-3 text-xs font-semibold min-h-12',
              dateChipId === 'other'
                ? 'border-brand bg-brand-tint text-brand ring-2 ring-brand/30'
                : 'border-rule-strong bg-surface text-ink active:bg-surface-2',
            )}
          >
            Other date
          </button>
        </div>

        {dateChipId === 'other' ? (
          <div className="mt-1">
            <Input
              type="date"
              label="Select arrival date"
              value={customArrivalDate}
              onChange={(e) => setCustomArrivalDate(e.target.value)}
            />
          </div>
        ) : null}
      </div>

      {/* 3. Arrival time: chips Morning / Afternoon / Evening / Night + optional exact time */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-bold uppercase tracking-wider text-muted">
          Arrival time
        </label>
        <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Arrival time of day">
          {ARRIVAL_TIME_SLOTS.map((slot) => (
            <button
              key={slot.id}
              type="button"
              onClick={() => setTimeSlotId(slot.id)}
              className={cn(
                'tap flex flex-col items-center justify-center rounded-xl border p-2 text-xs font-semibold leading-tight min-h-12',
                timeSlotId === slot.id
                  ? 'border-brand bg-brand-tint text-brand ring-2 ring-brand/30'
                  : 'border-rule-strong bg-surface text-ink active:bg-surface-2',
              )}
            >
              <span>{slot.label}</span>
              <span className="text-[10px] font-normal text-muted">{slot.time}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setTimeSlotId((prev) => (prev === 'custom' ? 'morning' : 'custom'))}
            className="text-xs font-medium text-brand underline active:text-ink"
          >
            {timeSlotId === 'custom' ? 'Use standard time slot' : '+ Enter exact time'}
          </button>
        </div>

        {timeSlotId === 'custom' ? (
          <div className="mt-1">
            <Input
              type="time"
              label="Exact arrival time"
              value={customArrivalTime}
              onChange={(e) => setCustomArrivalTime(e.target.value)}
            />
          </div>
        ) : null}
      </div>

      {/* 4. Mode: 4 big icon choices (Train / Flight / Bus / By road) */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-bold uppercase tracking-wider text-muted">
          Travel mode
        </label>
        <div className="grid grid-cols-4 gap-2" role="group" aria-label="Travel mode">
          {TRAVEL_MODE_CHIPS.map((chip) => {
            const isSelected = modeChipId === chip.id
            const Icon =
              chip.id === 'train'
                ? TrainIcon
                : chip.id === 'flight'
                  ? PlaneIcon
                  : chip.id === 'bus'
                    ? BusIcon
                    : CarIcon

            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => setModeChipId(chip.id)}
                className={cn(
                  'tap flex flex-col items-center justify-center gap-1.5 rounded-xl border p-2 text-xs font-semibold min-h-16',
                  'transition-[background-color,border-color,color] duration-press ease-ledger',
                  isSelected
                    ? 'border-brand bg-brand-tint text-brand ring-2 ring-brand/30'
                    : 'border-rule-strong bg-surface text-ink hover:bg-surface-2 active:bg-surface-2',
                )}
              >
                <Icon className={cn('h-6 w-6', isSelected ? 'text-brand' : 'text-muted')} />
                <span>{chip.label}</span>
              </button>
            )
          })}
        </div>

        {/* Optional train/flight reference */}
        {modeChipId === 'train' || modeChipId === 'flight' ? (
          <div className="mt-1">
            <Input
              label={modeChipId === 'train' ? 'Train number / name (optional)' : 'Flight number (optional)'}
              placeholder={modeChipId === 'train' ? 'e.g. 12951 Tejas Rajdhani' : 'e.g. 6E 5074'}
              value={flightTrainNo}
              onChange={(e) => setFlightTrainNo(e.target.value)}
            />
          </div>
        ) : null}
      </div>

      {/* 5. Needs pickup toggle */}
      <div className="flex items-center justify-between rounded-xl border border-rule-strong bg-surface-2 p-3">
        <div className="min-w-0 pr-2">
          <p className="text-sm font-semibold text-ink">Needs pickup</p>
          <p className="text-xs text-muted">Vehicle needed from airport or railway station</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={needsPickup}
          onClick={() => setNeedsPickup((v) => !v)}
          className={cn(
            'tap relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out',
            needsPickup ? 'bg-brand' : 'bg-rule-strong',
          )}
        >
          <span
            className={cn(
              'pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
              needsPickup ? 'translate-x-5' : 'translate-x-0',
            )}
          />
        </button>
      </div>

      {/* 6. Departure: default "Same as event end" with Edit */}
      <div className="flex flex-col gap-2 rounded-xl border border-rule bg-surface p-3">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <span className="text-xs font-bold uppercase tracking-wider text-muted">Departure</span>
            <p className="text-sm font-medium text-ink">
              {departureDate ? `Default: Event end (${departureDate})` : 'Same as event end'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowDepartureEdit((v) => !v)}
            className="tap flex items-center gap-1 text-xs font-semibold text-brand underline active:text-ink"
          >
            <span>{showDepartureEdit ? 'Hide' : 'Edit'}</span>
            {showDepartureEdit ? (
              <ChevronDownIcon className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <ChevronRightIcon className="h-3.5 w-3.5" aria-hidden />
            )}
          </button>
        </div>

        {showDepartureEdit ? (
          <div className="mt-2 flex flex-col gap-2 border-t border-rule pt-2">
            <Input
              type="date"
              label="Departure date"
              value={departureDate}
              onChange={(e) => setDepartureDate(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-2">
              <Input
                type="time"
                label="Departure time"
                value={departureTime}
                onChange={(e) => setDepartureTime(e.target.value)}
              />
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-muted">Departure mode</label>
                <select
                  value={departureMode}
                  onChange={(e) => setDepartureMode(e.target.value)}
                  className="tap flex min-h-12 w-full rounded-xl border border-rule-strong bg-surface px-3 text-sm font-medium text-ink"
                >
                  <option value="">Same as arrival</option>
                  <option value="train">Train</option>
                  <option value="flight">Flight</option>
                  <option value="bus">Bus</option>
                  <option value="road">By road</option>
                </select>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* 7. Notes optional */}
      <div>
        <Input
          label="Notes / dietary / special requests (optional)"
          placeholder="e.g. wheelchair, elderly, pure veg, ground floor room..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      {/* 8. Single filled Primary button to save and advance */}
      <Button
        variant="primary"
        size="lg"
        fullWidth
        disabled={totalGuests < 1 || isSaving}
        onClick={handleSubmit}
      >
        {isSaving ? 'Saving...' : `Save & next family`}
      </Button>
    </div>
  )
}

function Stepper({
  label,
  value,
  onChange,
  min = 0,
}: {
  label: string
  value: number
  onChange: (val: number) => void
  min?: number
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-rule-strong bg-surface p-2.5">
      <span className="text-xs font-medium text-muted">{label}</span>
      <div className="flex items-center justify-between gap-1">
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
          className="tap flex h-9 w-9 items-center justify-center rounded-lg border border-rule-strong bg-surface text-ink active:bg-surface-2 disabled:opacity-40"
        >
          <MinusIcon className="h-4 w-4" />
        </button>
        <span className="figure text-center text-lg font-bold text-ink">{value}</span>
        <button
          type="button"
          aria-label={`Increase ${label}`}
          onClick={() => onChange(value + 1)}
          className="tap flex h-9 w-9 items-center justify-center rounded-lg border border-rule-strong bg-surface text-ink active:bg-surface-2"
        >
          <PlusIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
