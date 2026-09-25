'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { AdminPageTitle } from '@/app/(admin)/AdminPageTitle'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Segmented } from '@/components/ui/Segmented'
import { Textarea } from '@/components/ui/Textarea'
import { createRooms } from '@/lib/actions/hotels'
import { lostResponseMessage } from '@/lib/errors'
import {
  ROOM_TYPE_CAPACITY,
  ROOM_TYPE_LABELS,
  ROOM_TYPES,
  type RoomType,
} from '@/lib/rooms/room-type'

interface Props {
  eventId: string
  hotelId: string
  eventCode: string
  hotelName: string
  /**
   * Where "Back to hotel" goes when finished.
   *
   * Defaults to the admin hotel page, which is the only caller this form had.
   * The staff room-create route passes its own, because `/admin/**` is behind
   * a layout that redirects any non-admin to `/` - sending an event_team user
   * there on success would bounce them off the app right after a good write.
   */
  backHref?: string
}

type Mode = 'range' | 'single'

const DEFAULT_TYPE: RoomType = 'standard'

/**
 * The one line that says what the tap will do: "Creates 10 Deluxe rooms:
 * 701-710". Rendered on every keystroke so a wrong starting number is caught
 * before the write, not after ten rooms exist.
 */
function rangePreview(prefix: string, start: number, qty: number, label: string): string {
  const first = `${prefix}${start}`
  const last = `${prefix}${start + qty - 1}`
  return `Creates ${qty} ${label} ${qty === 1 ? 'room' : 'rooms'}: ${first}-${last}`
}
export function RoomCreateForm({ eventId, hotelId, eventCode, hotelName, backHref }: Props) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('range')
  const [prefix, setPrefix] = useState('')
  const [startNumber, setStartNumber] = useState('101')
  const [qty, setQty] = useState('10')
  const [roomNumber, setRoomNumber] = useState('')
  const [roomType, setRoomType] = useState<RoomType>(DEFAULT_TYPE)
  const [floor, setFloor] = useState('')
  const [capacity, setCapacity] = useState(String(ROOM_TYPE_CAPACITY[DEFAULT_TYPE]))
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ created: number; skipped: string[] } | null>(null)

  const qtyNumber = parseInt(qty, 10)
  const startValue = parseInt(startNumber, 10)
  const capacityNumber = parseInt(capacity, 10)
  const rangeReady =
    Number.isFinite(qtyNumber) && qtyNumber >= 1 && Number.isFinite(startValue) && startValue >= 0
  const preview = rangeReady
    ? rangePreview(prefix, startValue, qtyNumber, ROOM_TYPE_LABELS[roomType])
    : null

  const submitLabel = submitting
    ? 'Creating...'
    : mode === 'single'
      ? 'Create room'
      : rangeReady
        ? `Create ${qtyNumber} ${qtyNumber === 1 ? 'room' : 'rooms'}`
        : 'Create rooms'

  /**
   * Picking a type re-seeds capacity from it, but only while capacity is still
   * that type's default. Otherwise choosing "Suite" would silently undo a
   * deliberate "4" typed a second earlier - and the ticket says the default is
   * a starting point that stays editable.
   */
  function chooseType(next: RoomType) {
    setRoomType(next)
    setCapacity((current) =>
      current === String(ROOM_TYPE_CAPACITY[roomType]) ? String(ROOM_TYPE_CAPACITY[next]) : current,
    )
  }
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await createRooms(
        eventId,
        hotelId,
        mode,
        mode === 'range'
          ? {
              roomType,
              qty: qtyNumber,
              startNumber: startValue,
              prefix,
              capacity: capacityNumber || ROOM_TYPE_CAPACITY[roomType],
            }
          : {
              roomNumber,
              roomType,
              floor: floor || null,
              capacity: capacityNumber || ROOM_TYPE_CAPACITY[roomType],
              notes: notes || null,
            },
      )
      if (res.ok) setResult({ created: res.created, skipped: res.skipped })
      else setError(res.error ?? 'Failed to create rooms.')
    } catch {
      // A server action can REJECT rather than return - a dropped connection
      // mid-flight is the ordinary cause on venue Wi-Fi. Without this catch the
      // rejection escaped, `setSubmitting(false)` never ran, and the button sat
      // on "Creating..." forever with nothing on screen. The rooms may still
      // have been written, so the sentence says so and names the room list.
      setError(lostResponseMessage('the room list'))
    } finally {
      setSubmitting(false)
    }
  }
  if (result) {
    return (
      <div className="flex flex-col items-center gap-6 py-12 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-tint text-ledger-green">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><polyline points="20 6 9 17 4 12" /></svg>
        </div>
        <div>
          <h2 className="font-display text-xl leading-tight font-semibold tracking-tight text-ink">
            Rooms created
          </h2>
          <p className="mt-1 text-muted">
            <span className="figure">{result.created}</span> room
            {result.created === 1 ? '' : 's'} added
            {result.skipped.length > 0 ? ` - ${result.skipped.length} already there` : ''}
          </p>
          {result.skipped.length > 0 ? (
            <p className="mt-1 text-sm leading-snug text-muted">
              Skipped <span className="figure">{result.skipped.join(', ')}</span> - those numbers
              already existed in this hotel.
            </p>
          ) : null}
        </div>
        <div className="flex gap-3">
          <Button
            variant="secondary"
            onClick={() => {
              setResult(null)
              if (rangeReady) setStartNumber(String(startValue + qtyNumber))
            }}
          >
            Add more
          </Button>
          <Button variant="primary" onClick={() => { router.push(backHref ?? `/admin/events/${eventCode}/hotels/${hotelId}`); router.refresh() }}>Back to hotel</Button>
        </div>
      </div>
    )
  }
  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <AdminPageTitle context={hotelName}>Add rooms</AdminPageTitle>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-ledger-red/35 bg-red-tint px-4 py-3 text-sm font-medium text-ledger-red"
        >
          {error}
        </div>
      ) : null}

      <Segmented<Mode>
        label="How to add rooms"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'range', label: 'Range' },
          { value: 'single', label: 'Single' },
        ]}
      />

      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="eyebrow">Room type <span className="text-ledger-red">*</span></span>
          <select
            value={roomType}
            onChange={(e) => chooseType(e.target.value as RoomType)}
            className="tap min-h-14 rounded-xl border border-rule-strong bg-surface px-4 text-base text-ink"
          >
            {ROOM_TYPES.map((t) => (
              <option key={t} value={t}>{ROOM_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="eyebrow">Capacity <span className="text-ledger-red">*</span></span>
          <Input value={capacity} onChange={(e) => setCapacity(e.target.value)} type="number" min="1" required />
        </label>
      </div>
      {mode === 'range' ? (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="eyebrow">Starting number <span className="text-ledger-red">*</span></span>
              <Input value={startNumber} onChange={(e) => setStartNumber(e.target.value)} type="number" min="0" inputMode="numeric" required />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="eyebrow">How many <span className="text-ledger-red">*</span></span>
              <Input value={qty} onChange={(e) => setQty(e.target.value)} type="number" min="1" max="500" inputMode="numeric" required />
            </label>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="eyebrow">Room prefix</span>
            <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="e.g. A- for A-701, A-702..." />
          </label>
          <p className="text-sm text-muted" aria-live="polite">
            {preview ?? 'Enter a starting number and how many rooms to see the range.'}
          </p>
        </div>
      ) : (
        <label className="flex flex-col gap-1.5">
          <span className="eyebrow">Room number <span className="text-ledger-red">*</span></span>
          <Input value={roomNumber} onChange={(e) => setRoomNumber(e.target.value)} placeholder="e.g. 304" required />
        </label>
      )}

      {mode === 'single' ? (
        <>
          <label className="flex flex-col gap-1.5"><span className="eyebrow">Floor</span><Input value={floor} onChange={(e) => setFloor(e.target.value)} placeholder="e.g. 1, Ground" /></label>
          <label className="flex flex-col gap-1.5"><span className="eyebrow">Notes</span><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></label>
        </>
      ) : null}
      {/* bottom-nav, not bottom-0: both shells put a fixed bar at the bottom
          (the staff tab bar, the admin mobile nav), so a submit stuck to the
          viewport bottom sits underneath it. md:bottom-0 because both bars are
          md:hidden. */}
      <div className="sticky bottom-nav flex items-center gap-3 bg-paper pt-2 pb-2 md:bottom-0 md:pb-safe">
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={submitting}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={submitting} className="flex-1">
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}

export default RoomCreateForm