'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { PageTitle } from '@/components/ui/PageTitle'
import { createRooms } from '@/lib/actions/hotels'

interface Props {
  eventId: string
  hotelId: string
  eventCode: string
  hotelName: string
}

export function RoomCreateForm({ eventId, hotelId, eventCode, hotelName }: Props) {
  const router = useRouter()
  const [mode, setMode] = useState<'range' | 'single'>('range')
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
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
        </div>
        <div>
          <h2 className="text-xl font-semibold text-fg">Rooms created</h2>
          <p className="mt-1 text-muted">{result.created} room{result.created === 1 ? '' : 's'} added{result.skipped > 0 ? ` · ${result.skipped} skipped` : ''}</p>
        </div>
        <div className="flex gap-3">
          <Button variant="ghost" onClick={() => { setResult(null); setPrefix(''); setStart('1'); setEnd('10'); setRoomNumber('') }}>Add more</Button>
          <Button variant="primary" onClick={() => { router.push(`/admin/events/${eventCode}/hotels/${hotelId}`); router.refresh() }}>Back to hotel</Button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <PageTitle>Add rooms — {hotelName}</PageTitle>
      {error ? <div role="alert" className="rounded-xl bg-tint-danger px-4 py-3 text-sm font-medium text-danger">{error}</div> : null}
      <div className="flex gap-2 rounded-xl bg-surface p-1">
        <button type="button" onClick={() => setMode('range')} className={`tap flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${mode === 'range' ? 'bg-paper text-fg shadow-sm' : 'text-muted'}`}>Range</button>
        <button type="button" onClick={() => setMode('single')} className={`tap flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${mode === 'single' ? 'bg-paper text-fg shadow-sm' : 'text-muted'}`}>Single</button>
      </div>
      {mode === 'range' ? (
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-fg">Room prefix</span>
            <Input value={prefix} onChange={e => setPrefix(e.target.value)} placeholder="e.g. 2 for rooms 201, 202…" />
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1.5"><span className="text-sm font-medium text-fg">First number</span><Input value={start} onChange={e => setStart(e.target.value)} type="number" min="1" required /></label>
            <label className="flex flex-col gap-1.5"><span className="text-sm font-medium text-fg">Last number</span><Input value={end} onChange={e => setEnd(e.target.value)} type="number" min="1" required /></label>
          </div>
          <p className="text-xs text-muted">Preview: {prefix}{start.padStart(end.length, '0')} → {prefix}{end.padStart(end.length, '0')}</p>
        </div>
      ) : (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-fg">Room number <span className="text-danger">*</span></span>
          <Input value={roomNumber} onChange={e => setRoomNumber(e.target.value)} placeholder="e.g. 304" required />
        </label>
      )}
      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-fg">Type</span>
          <select value={roomType} onChange={e => setRoomType(e.target.value)} className="tap min-h-12 rounded-xl border border-border bg-surface px-3 text-sm text-fg">
            <option value="">Select…</option>
            <option value="Standard">Standard</option><option value="Deluxe">Deluxe</option><option value="Suite">Suite</option><option value="Twin">Twin</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-fg">Capacity <span className="text-danger">*</span></span>
          <Input value={capacity} onChange={e => setCapacity(e.target.value)} type="number" min="1" required />
        </label>
      </div>
      <label className="flex flex-col gap-1.5"><span className="text-sm font-medium text-fg">Floor</span><Input value={floor} onChange={e => setFloor(e.target.value)} placeholder="e.g. 1, Ground" /></label>
      <label className="flex flex-col gap-1.5"><span className="text-sm font-medium text-fg">Notes</span><Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} /></label>
      <div className="flex items-center gap-3 sticky bottom-0 bg-paper pt-2 pb-safe">
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={submitting}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={submitting} className="flex-1">{submitting ? 'Creating…' : mode === 'range' ? `Create ${Math.abs(parseInt(end, 10) - parseInt(start, 10)) + 1 || 0} rooms` : 'Create room'}</Button>
      </div>
    </form>
  )
}
