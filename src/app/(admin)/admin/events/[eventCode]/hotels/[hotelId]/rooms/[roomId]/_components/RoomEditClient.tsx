'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { AdminPageTitle } from '@/app/(admin)/AdminPageTitle'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { updateRoom } from '@/lib/actions/hotels'
import { lostResponseMessage } from '@/lib/errors'
import { ROOM_TYPE_LABELS, ROOM_TYPES } from '@/lib/rooms/room-type'

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
    try {
      const result = await updateRoom(roomId, eventId, { roomNumber, roomType: roomType || null, floor: floor || null, capacity: parseInt(capacity, 10) || 2, notes: notes || null, isBlocked })
      if (result.ok) { router.push(`/admin/events/${eventCode}/hotels/${hotelId}`); router.refresh() }
      else setError(result.error ?? 'Failed')
    } catch {
      // The action can REJECT rather than return (a dropped connection), which
      // used to leave the button on "Saving…" for good. The edit may still have
      // landed, so say that and point at the room list.
      setError(lostResponseMessage('the room list'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <AdminPageTitle context="Room">Edit room {initial.roomNumber}</AdminPageTitle>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-ledger-red/35 bg-red-tint px-4 py-3 text-sm font-medium text-ledger-red"
        >
          {error}
        </div>
      ) : null}

      <label className="flex flex-col gap-1.5">
        <span className="eyebrow">Room number <span className="text-ledger-red">*</span></span>
        <Input value={roomNumber} onChange={e => setRoomNumber(e.target.value)} required />
      </label>

      <div className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="eyebrow">Type</span>
          <select
            value={roomType}
            onChange={e => setRoomType(e.target.value)}
            className="tap min-h-14 rounded-xl border border-rule-strong bg-surface px-4 text-base text-ink"
          >
            <option value="">Select…</option>{ROOM_TYPES.map((t) => (<option key={t} value={t}>{ROOM_TYPE_LABELS[t]}</option>))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="eyebrow">Capacity <span className="text-ledger-red">*</span></span>
          <Input value={capacity} onChange={e => setCapacity(e.target.value)} type="number" min="1" required />
        </label>
      </div>

      <label className="flex flex-col gap-1.5"><span className="eyebrow">Floor</span><Input value={floor} onChange={e => setFloor(e.target.value)} /></label>
      <label className="flex flex-col gap-1.5"><span className="eyebrow">Notes</span><Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} /></label>

      <label className="flex min-h-11 items-center gap-3 rounded-xl border border-rule p-3">
        <input type="checkbox" checked={isBlocked} onChange={e => setIsBlocked(e.target.checked)} className="h-5 w-5 rounded accent-brand" />
        <span>
          <span className="block text-sm font-medium text-ink">Block this room</span>
          <span className="block text-xs text-muted">No new allocations until unblocked</span>
        </span>
      </label>

      <div className="sticky bottom-nav flex items-center gap-3 bg-paper pt-2 pb-2 md:bottom-0 md:pb-safe">
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={submitting}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={submitting} className="flex-1">
          {submitting ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </form>
  )
}

export default RoomEditClient
