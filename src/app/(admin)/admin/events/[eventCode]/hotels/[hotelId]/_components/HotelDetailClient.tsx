'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

import { AdminPageTitle } from '@/app/(admin)/AdminPageTitle'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { LinkButton } from '@/components/ui/LinkButton'
import { Textarea } from '@/components/ui/Textarea'
import { PlusIcon, BuildingIcon } from '@/components/icons'
import { createClient } from '@/lib/supabase/client'
import { updateHotel } from '@/lib/actions/hotels'
import { deleteRoom } from '@/lib/actions/hotels'

interface Props {
  hotelId: string
  eventId: string
  eventCode: string
  initial: { name: string; address: string | null; contactName: string | null; contactMobile: string | null; notes: string | null }
}

interface RoomRow {
  id: string
  room_number: string
  room_type: string | null
  floor: string | null
  capacity: number
  occupantCount: number
}

/** Inline SVG edit icon — avoids needing every icon in the shared file. */
function EditIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  )
}

export function HotelDetailClient({ hotelId, eventId, eventCode, initial }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(initial.name)
  const [address, setAddress] = useState(initial.address ?? '')
  const [contactName, setContactName] = useState(initial.contactName ?? '')
  const [contactMobile, setContactMobile] = useState(initial.contactMobile ?? '')
  const [notes, setNotes] = useState(initial.notes ?? '')
  const [rooms, setRooms] = useState<RoomRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    const sf = createClient()
    Promise.all([
      sf.from('rooms').select('id, room_number, room_type, floor, capacity').eq('hotel_id', hotelId).order('room_number'),
      sf.from('room_assignments').select('room_id').eq('event_id', eventId).is('released_at', null),
    ]).then(([roomsRes, assignRes]) => {
      if (roomsRes.error) { setError(roomsRes.error.message); setLoading(false); return }
      const occMap = new Map<string, number>()
      for (const a of assignRes.data ?? []) {
        occMap.set(a.room_id, (occMap.get(a.room_id) ?? 0) + 1)
      }
      setRooms((roomsRes.data ?? []).map(r => ({ ...r, occupantCount: occMap.get(r.id) ?? 0 })))
      setLoading(false)
    })
  }, [hotelId, eventId])

  async function handleSave() {
    setSubmitting(true)
    const result = await updateHotel(hotelId, eventId, { name, address: address || null, contactName: contactName || null, contactMobile: contactMobile || null, notes: notes || null })
    if (result.ok) { setEditing(false); router.refresh() }
    else setError(result.error ?? 'Failed')
    setSubmitting(false)
  }

  async function handleDeleteRoom(roomId: string, roomNumber: string) {
    // Deleting a room is not undoable and the control sits next to Edit, one
    // thumb-width away. It asked nothing before.
    if (!window.confirm(`Delete room ${roomNumber}?\n\nThis cannot be undone.`)) return
    const result = await deleteRoom(roomId, eventId)
    if (result.ok) setRooms(r => r.filter(r => r.id !== roomId))
    else alert(result.error)
  }

  return (
    <div className="flex flex-col gap-6">
      <AdminPageTitle
        context={`${rooms.length} room${rooms.length === 1 ? '' : 's'}`}
        actions={
          editing ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditing(false)
                  setName(initial.name)
                  setAddress(initial.address ?? '')
                  setContactName(initial.contactName ?? '')
                  setContactMobile(initial.contactMobile ?? '')
                  setNotes(initial.notes ?? '')
                }}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={handleSave} disabled={submitting}>
                {submitting ? 'Saving…' : 'Save'}
              </Button>
            </>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<EditIcon />}
              onClick={() => setEditing(true)}
            >
              Edit
            </Button>
          )
        }
      >
        {editing ? 'Edit hotel' : initial.name}
      </AdminPageTitle>

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-ledger-red/35 bg-red-tint px-4 py-3 text-sm font-medium text-ledger-red"
        >
          {error}
        </div>
      ) : null}

      {editing ? (
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="eyebrow">Hotel name <span className="text-ledger-red">*</span></span>
            <Input value={name} onChange={e => setName(e.target.value)} required />
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1.5"><span className="eyebrow">Contact</span><Input value={contactName} onChange={e => setContactName(e.target.value)} placeholder="Name" /></label>
            <label className="flex flex-col gap-1.5"><span className="eyebrow">Phone</span><Input value={contactMobile} onChange={e => setContactMobile(e.target.value)} type="tel" placeholder="+91" /></label>
          </div>
          <label className="flex flex-col gap-1.5"><span className="eyebrow">Address</span><Textarea value={address} onChange={e => setAddress(e.target.value)} rows={2} /></label>
          <label className="flex flex-col gap-1.5"><span className="eyebrow">Notes</span><Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} /></label>
        </div>
      ) : (
        <div className="flex flex-col gap-1 text-sm text-muted">
          {initial.address ? <p>{initial.address}</p> : null}
          {initial.contactName ? (
            <p>
              {initial.contactName}
              {initial.contactMobile ? (
                <>
                  {' · '}
                  <span className="code-figure">{initial.contactMobile}</span>
                </>
              ) : null}
            </p>
          ) : null}
          {initial.notes ? <p className="text-subtle">{initial.notes}</p> : null}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-rule pt-4">
        <h2 className="font-display text-xl leading-tight font-semibold tracking-tight text-ink">
          Rooms
        </h2>
        <LinkButton
          href={`/admin/events/${eventCode}/hotels/${hotelId}/rooms`}
          size="sm"
          leadingIcon={<PlusIcon className="h-4 w-4" />}
        >
          Add rooms
        </LinkButton>
      </div>

      {loading ? (
        <div className="flex flex-col gap-3" aria-busy>
          {Array.from({ length: 3 }, (_, i) => <div key={i} className="h-16 rounded-2xl bg-surface" />)}
        </div>
      ) : rooms.length === 0 ? (
        <EmptyState icon={<BuildingIcon className="h-7 w-7" />} title="No rooms yet" description="Add rooms here, or import a sheet." />
      ) : (
        /* A dense admin register — number, type, floor, capacity, occupancy and
           two controls per line — so it stays a grid rather than being forced
           into `Row`, whose name-plus-one-meta-line shape needs the width a
           room number, a status and two 44px controls do not leave. */
        <Card>
          <ul>
            {rooms.map(room => (
              <li
                key={room.id}
                className="flex items-center gap-3 border-b border-rule px-3 py-2.5 last:border-b-0"
              >
                <span className="figure flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-sm font-semibold text-ink">
                  {room.room_number}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base leading-snug font-medium text-ink">
                    {room.room_type ?? 'Standard'}
                  </p>
                  <p className="truncate text-sm leading-snug text-muted">
                    {room.floor ? `Floor ${room.floor} · ` : ''}Capacity {room.capacity}
                    {room.occupantCount > 0 ? ` · ${room.occupantCount} in` : ' · empty'}
                  </p>
                </div>
                {/* Was `opacity-0 group-hover:opacity-100`. A phone has no hover,
                    so Edit and Delete were invisible on every handset — rooms
                    could not be edited at all from the field — while still being
                    tappable, which made Delete an unlabelled trap. Always visible
                    now, at 44px per the mobile tap-target rule. */}
                <div className="flex shrink-0 items-center gap-1">
                  <Link
                    href={`/admin/events/${eventCode}/hotels/${hotelId}/rooms/${room.id}`}
                    aria-label={`Edit room ${room.room_number}`}
                    className="tap flex h-11 w-11 items-center justify-center rounded-xl text-muted hover:bg-surface-2 hover:text-ink active:bg-surface-2"
                  >
                    <EditIcon />
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="hover:text-ledger-red"
                    onClick={() => void handleDeleteRoom(room.id, room.room_number)}
                    aria-label={`Delete room ${room.room_number}`}
                  >
                    <TrashIcon />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

export default HotelDetailClient
