'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { AdminPageTitle } from '@/app/(admin)/AdminPageTitle'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Segmented } from '@/components/ui/Segmented'
import { Textarea } from '@/components/ui/Textarea'
import { createRooms } from '@/lib/actions/hotels'

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
   * a layout that redirects any non-admin to `/` — sending an event_team user
   * there on success would bounce them off the app right after a good write.
   */
  backHref?: string
}

type Mode = 'range' | 'single'

export function RoomCreateForm({ eventId, hotelId, eventCode, hotelName, backHref }: Props) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('range')
  const [prefix, setPrefix] = useState('')
  const [start, setStart] = useState('1')
  const [end, setEnd] = useState('10')
  const [roomNumber, setRoomNumber] = useState('')
  const [roomType, setRoomType] = useState('')
  const [floor, setFloor] = useState('')
  const [capacity, setCapacity] = useState('2')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const res = await createRooms(eventId, hotelId, mode,
      mode === 'range'
        ? { prefix, start: parseInt(start, 10), end: parseInt(end, 10), roomType: roomType || null, floor: floor || null, capacity: parseInt(capacity, 10) || 2, notes: notes || null }
        : { roomNumber, roomType: roomType || null, floor: floor || null, capacity: parseInt(capacity, 10) || 2, notes: notes || null })
    if (res.ok) setResult({ created: res.created, skipped: res.skipped })
    else setError(res.error ?? 'Failed to create rooms.')
    setSubmitting(false)
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
            {result.skipped > 0 ? ` · ${result.skipped} skipped` : ''}
          </p>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => { setResult(null); setPrefix(''); setStart('1'); setEnd('10'); setRoomNumber('') }}>Add more</Button>
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

      {mode === 'range' ? (
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="eyebrow">Room prefix</span>
            <Input value={prefix} onChange={e => setPrefix(e.target.value)} placeholder="e.g. 2 for rooms 201, 202…" />
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1.5"><span className="eyebrow">First number</span><Input value={start} onChange={e => setStart(e.target.value)} type="number" min="1" required /></label>
            <label className="flex flex-col gap-1.5"><span className="eyebrow">Last number</span><Input value={end} onChange={e => setEnd(e.target.value)} type="number" min="1" required /></label>
          </div>
          <p className="text-sm text-muted">
            Preview: <span className="figure">{prefix}{start.padStart(end.length, '0')}</span> →{' '}
            <span className="figure">{prefix}{end.padStart(end.length, '0')}</span>
          </p>
        </div>
      ) : (
        <label className="flex flex-col gap-1.5">
          <span className="eyebrow">Room number <span className="text-ledger-red">*</span></span>
          <Input value={roomNumber} onChange={e => setRoomNumber(e.target.value)} placeholder="e.g. 304" required />
        </label>
      )}

      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="eyebrow">Type</span>
          <select
            value={roomType}
            onChange={e => setRoomType(e.target.value)}
            className="tap min-h-14 rounded-xl border border-rule-strong bg-surface px-4 text-base text-ink"
          >
            <option value="">Select…</option>
            <option value="Standard">Standard</option><option value="Deluxe">Deluxe</option><option value="Suite">Suite</option><option value="Twin">Twin</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="eyebrow">Capacity <span className="text-ledger-red">*</span></span>
          <Input value={capacity} onChange={e => setCapacity(e.target.value)} type="number" min="1" required />
        </label>
      </div>

      <label className="flex flex-col gap-1.5"><span className="eyebrow">Floor</span><Input value={floor} onChange={e => setFloor(e.target.value)} placeholder="e.g. 1, Ground" /></label>
      <label className="flex flex-col gap-1.5"><span className="eyebrow">Notes</span><Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} /></label>

      {/* bottom-nav, not bottom-0: both shells put a fixed bar at the bottom
          (the staff tab bar, the admin mobile nav), so a submit stuck to the
          viewport bottom sits underneath it. md:bottom-0 because both bars are
          md:hidden. */}
      <div className="sticky bottom-nav flex items-center gap-3 bg-paper pt-2 pb-2 md:bottom-0 md:pb-safe">
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={submitting}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={submitting} className="flex-1">
          {submitting ? 'Creating…' : mode === 'range' ? `Create ${Math.abs(parseInt(end, 10) - parseInt(start, 10)) + 1 || 0} rooms` : 'Create room'}
        </Button>
      </div>
    </form>
  )
}

export default RoomCreateForm
