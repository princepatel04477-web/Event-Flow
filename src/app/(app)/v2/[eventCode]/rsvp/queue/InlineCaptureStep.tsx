'use client'

import { useCallback, useEffect, useState } from 'react'

import { CarIcon, ChevronDownIcon, ChevronRightIcon, PlaneIcon } from '@/components/icons'
import { Input } from '@/components/ui/Input'
import { Stepper } from '@/components/ui/Stepper'
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
  /** When true, save is triggered from the screen BottomBar instead of inline. */
  deferSubmit?: boolean
  onSubmitReady?: (submit: () => void, canSave: boolean) => void
}

export function InlineCaptureStep({
  status,
  family,
  expectedPax,
  startsOn,
  endsOn,
  onSave,
  onCancel,
  deferSubmit = false,
  onSubmitReady,
}: InlineCaptureStepProps) {
  const initialAdults = family?.adults_confirmed ?? Math.max(expectedPax || 1, 1)
  const initialChildren = family?.children_confirmed ?? 0
  const [adults, setAdults] = useState<number>(initialAdults)
  const [children, setChildren] = useState<number>(initialChildren)

  const dateChips = getArrivalDateChips(startsOn)
  const [dateChipId, setDateChipId] = useState<string>('day_0')
  const [customArrivalDate, setCustomArrivalDate] = useState<string>('')

  const [timeSlotId, setTimeSlotId] = useState<ArrivalTimeSlotId | 'custom'>('morning')
  const [customArrivalTime, setCustomArrivalTime] = useState<string>('')

  const [modeChipId, setModeChipId] = useState<TravelModeChipId>('train')
  const [flightTrainNo, setFlightTrainNo] = useState<string>('')

  const [needsPickup, setNeedsPickup] = useState<boolean>(family?.needs_pickup ?? false)

  const defaultDepDate = defaultDepartureDate(startsOn, endsOn)
  const [departureDate, setDepartureDate] = useState<string>(defaultDepDate)
  const [departureTime, setDepartureTime] = useState<string>('')
  const [departureMode, setDepartureMode] = useState<string>('')
  const [showDepartureEdit, setShowDepartureEdit] = useState<boolean>(false)

  const [notes, setNotes] = useState<string>(family?.remarks ?? '')

  const totalGuests = adults + children
  const isConfirmed = status === 'confirmed'

  const canSave = totalGuests >= 1

  const handleSubmit = useCallback(() => {
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
  }, [
    totalGuests,
    dateChipId,
    startsOn,
    customArrivalDate,
    timeSlotId,
    customArrivalTime,
    modeChipId,
    flightTrainNo,
    needsPickup,
    departureDate,
    departureTime,
    departureMode,
    notes,
    status,
    adults,
    children,
    onSave,
  ])

  useEffect(() => {
    if (!deferSubmit || !onSubmitReady) return
    onSubmitReady(handleSubmit, canSave)
  }, [deferSubmit, onSubmitReady, handleSubmit, canSave])

  return (
    <div
      className="flex flex-col gap-4 rounded-2xl border border-rule bg-surface-2 p-4"
      role="region"
      aria-label="Capture RSVP travel details"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-ink">
          {isConfirmed ? 'Guests and travel' : 'Maybe — what they know'}
        </h3>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 text-sm font-medium text-muted underline-offset-2 hover:underline"
        >
          Cancel
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Stepper label="Adults" value={adults} onChange={setAdults} min={0} />
        <Stepper label="Kids" value={children} onChange={setChildren} min={0} />
      </div>
      {totalGuests < 1 ? (
        <p role="alert" className="text-sm font-medium text-ledger-red">
          Add at least one guest
        </p>
      ) : (
        <p className="text-sm text-muted">
          {totalGuests} {totalGuests === 1 ? 'guest' : 'guests'}
          {expectedPax ? ` · expected ${expectedPax}` : ''}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-ink">Arrival date</span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Arrival date options">
          {dateChips.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setDateChipId(c.id)}
              className={cn(
                'tap flex min-h-10 flex-col items-center justify-center rounded-xl border px-3 py-1.5 text-xs font-semibold',
                dateChipId === c.id
                  ? 'border-brand bg-brand-tint text-brand'
                  : 'border-rule-strong bg-surface text-ink',
              )}
            >
              <span>{c.label}</span>
              <span className="text-[11px] font-normal text-muted">{c.sublabel}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setDateChipId('other')}
            className={cn(
              'tap flex min-h-10 items-center justify-center rounded-xl border px-3 text-xs font-semibold',
              dateChipId === 'other'
                ? 'border-brand bg-brand-tint text-brand'
                : 'border-rule-strong bg-surface text-ink',
            )}
          >
            Other
          </button>
        </div>
        {dateChipId === 'other' ? (
          <Input
            type="date"
            label="Arrival date"
            value={customArrivalDate}
            onChange={(e) => setCustomArrivalDate(e.target.value)}
          />
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-ink">Arrival time</span>
        <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Arrival time of day">
          {ARRIVAL_TIME_SLOTS.map((slot) => (
            <button
              key={slot.id}
              type="button"
              onClick={() => setTimeSlotId(slot.id)}
              className={cn(
                'tap flex min-h-10 flex-col items-center justify-center rounded-xl border p-1.5 text-xs font-semibold',
                timeSlotId === slot.id
                  ? 'border-brand bg-brand-tint text-brand'
                  : 'border-rule-strong bg-surface text-ink',
              )}
            >
              <span>{slot.label}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setTimeSlotId((prev) => (prev === 'custom' ? 'morning' : 'custom'))}
          className="self-start text-sm font-medium text-brand underline-offset-2 hover:underline"
        >
          {timeSlotId === 'custom' ? 'Use time slot' : 'Exact time'}
        </button>
        {timeSlotId === 'custom' ? (
          <Input
            type="time"
            label="Exact arrival time"
            value={customArrivalTime}
            onChange={(e) => setCustomArrivalTime(e.target.value)}
          />
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-ink">Travel mode</span>
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
                  'tap flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border p-1.5 text-xs font-semibold',
                  isSelected
                    ? 'border-brand bg-brand-tint text-brand'
                    : 'border-rule-strong bg-surface text-ink',
                )}
              >
                <Icon className={cn('h-5 w-5', isSelected ? 'text-brand' : 'text-muted')} />
                <span>{chip.label}</span>
              </button>
            )
          })}
        </div>
        {modeChipId === 'train' || modeChipId === 'flight' ? (
          <Input
            label={modeChipId === 'train' ? 'Train no. (optional)' : 'Flight no. (optional)'}
            placeholder={modeChipId === 'train' ? '12951' : '6E 5074'}
            value={flightTrainNo}
            onChange={(e) => setFlightTrainNo(e.target.value)}
            className="code-figure"
          />
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl border border-rule bg-surface px-3 py-2.5">
        <span className="text-sm font-medium text-ink">Needs pickup</span>
        <button
          type="button"
          role="switch"
          aria-checked={needsPickup}
          onClick={() => setNeedsPickup((v) => !v)}
          className={cn(
            'tap relative inline-flex h-7 w-12 shrink-0 rounded-full border-2 border-transparent',
            needsPickup ? 'bg-brand' : 'bg-rule-strong',
          )}
        >
          <span
            className={cn(
              'inline-block h-6 w-6 rounded-full bg-surface shadow transition-transform',
              needsPickup ? 'translate-x-5' : 'translate-x-0',
            )}
          />
        </button>
      </div>

      <div className="rounded-xl border border-rule bg-surface p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <span className="text-sm font-medium text-ink">Departure</span>
            <p className="text-sm text-muted">
              {departureDate ? `Event end · ${departureDate}` : 'Same as event end'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowDepartureEdit((v) => !v)}
            className="tap flex min-h-11 items-center gap-1 text-sm font-medium text-brand"
          >
            {showDepartureEdit ? 'Hide' : 'Edit'}
            {showDepartureEdit ? (
              <ChevronDownIcon className="h-4 w-4" aria-hidden />
            ) : (
              <ChevronRightIcon className="h-4 w-4" aria-hidden />
            )}
          </button>
        </div>
        {showDepartureEdit ? (
          <div className="mt-3 flex flex-col gap-2 border-t border-rule pt-3">
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
                <label className="text-sm text-muted">Mode</label>
                <select
                  value={departureMode}
                  onChange={(e) => setDepartureMode(e.target.value)}
                  className="tap min-h-11 w-full rounded-xl border border-rule-strong bg-surface px-3 text-sm text-ink"
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

      <Input
        label="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      {!deferSubmit ? (
        <button
          type="button"
          disabled={!canSave}
          onClick={handleSubmit}
          className="tap min-h-14 w-full rounded-xl bg-brand text-base font-semibold text-brand-fg disabled:opacity-55"
        >
          Save · next family
        </button>
      ) : null}
    </div>
  )
}
