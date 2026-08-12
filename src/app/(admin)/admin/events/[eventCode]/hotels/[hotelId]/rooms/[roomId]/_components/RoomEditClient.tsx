'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { PageTitle } from '@/components/ui/PageTitle'
import { updateRoom } from '@/lib/actions/hotels'

interface Props {
  roomId: string; eventId: string; eventCode: string; hotelId: string
  initial: { roomNumber: string; roomType: string | null; floor: string | null; capacity: number; notes: string | null; isBlocked: boolean }
}

export function RoomEditClient({ roomId, eventId, eventCode, hotelId, initial }: Props) {
  const router = useRouter()
  const [roomNumber, setRoomNumber] = useState(initial.roomNumber)
  const [roomType, setRoomType] = useState(initial.roomType ?? '')
  const [floor, setFloor] = useState(initial.floor ?? '')
  const [capacity, setCapacity] = useState(String(initial.capacity))
  const [notes, setNotes] = useState(initial.notes ?? '')
  const [isBlocked, setIsBlocked] = useState(initial.isBlocked)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setError(null); setSubmitting(true)
    const result = await updateRoom(roomId, eventId, { roomNumber, roomType: roomType || null, floor: floor || null, capacity: parseInt(capacity, 10) || 2, notes: notes || null, isBlocked })
    if (result.ok) { router.push(`/admin/events/${eventCode}/hotels/${hotelId}`); router.refresh() }
    else setError(result.error ?? 'Failed')
    setSubmitting(false)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <PageTitle>Edit room {initial.roomNumber}</PageTitle>
      {error ? <div role="alert" className="rounded-xl bg-tint-danger px-4 py-3 text-sm font-medium text-danger">{error}</div> : null}
      <label className="flex flex-col gap-1.5"><span className="text-sm font-medium text-fg">Room number <span className="text-danger">*</span></span><Input value={roomNumber} onChange={e => setRoomNumber(e.target.value)} required /></label>
      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1.5"><span className="text-sm font-medium text-fg">Type</span>
          <select value={roomType} onChange={e => setRoomType(e.target.value)} className="tap min-h-12 rounded-xl border border-border bg-surface px-3 text-sm text-fg"><option value="">Select…</option><option value="Standard">Standard</option><option value="Deluxe">Deluxe</option><option value="Suite">Suite</option><option value="Twin">Twin</option></select>
        </label>
        <label className="flex flex-col gap-1.5"><span className="text-sm font-medium text-fg">Capacity <span className="text-danger">*</span></span><Input value={capacity} onChange={e => setCapacity(e.target.value)} type="number" min="1" required /></label>
      </div>
      <label className="flex flex-col gap-1.5"><span className="text-sm font-medium text-fg">Floor</span><Input value={floor} onChange={e => setFloor(e.target.value)} /></label>
      <label className="flex flex-col gap-1.5"><span className="text-sm font-medium text-fg">Notes</span><Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} /></label>
      <label className="flex items-center gap-3 rounded-xl border border-rule p-3">
        <input type="checkbox" checked={isBlocked} onChange={e => setIsBlocked(e.target.checked)} className="h-5 w-5 rounded accent-brand" />
        <div><p className="text-sm font-medium text-fg">Block this room</p><p className="text-xs text-muted">Prevents new allocations until unblocked</p></div>
      </label>
      <div className="flex items-center gap-3 sticky bottom-0 bg-paper pt-2 pb-safe">
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={submitting}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={submitting} className="flex-1">{submitting ? 'Saving…' : 'Save changes'}</Button>
      </div>
    </form>
  )
}
