import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { ChevronLeftIcon } from '@/components/icons'
import { Card, CardBody } from '@/components/ui/Card'
import { friendlyDbError } from '@/lib/errors'
import { resolveAdminEvent } from '@/lib/events/adminEvent'
import { createClient } from '@/lib/supabase/server'

import { AddRooms } from './AddRooms'
import { RoomImport } from './RoomImport'
import { RoomList, type RoomRow } from './RoomList'

export const metadata: Metadata = {
  title: 'Rooms',
}

type PageProps = {
  params: Promise<{ hotelId: string }>
  searchParams: Promise<{ event?: string }>
}

export default async function HotelRoomsPage({ params, searchParams }: PageProps) {
  const { hotelId } = await params
  const { event: eventCode } = await searchParams
  const { selected, error } = await resolveAdminEvent(eventCode)

  if (error) {
    return (
      <Card className="border-danger/40 bg-tint-danger">
        <CardBody className="py-3 text-sm text-danger">{error}</CardBody>
      </Card>
    )
  }
  if (!selected) notFound()

  const supabase = await createClient()

  const { data: hotel } = await supabase
    .from('hotels')
    .select('id, name')
    .eq('id', hotelId)
    .eq('event_id', selected.id)
    .maybeSingle()

  if (!hotel) notFound()

  const [roomsRes, assignmentsRes] = await Promise.all([
    supabase
      .from('rooms')
      .select('id, room_number, room_type, capacity, floor')
      .eq('hotel_id', hotelId)
      .eq('event_id', selected.id),
    // Active allocations only — a released one is history, and showing it
    // would put a guest in a room somebody else is now standing in.
    supabase
      .from('room_assignments')
      .select('room_id, guest_id, guests(full_name), guest_groups(head_name)')
      .eq('event_id', selected.id)
      .is('released_at', null),
  ])

  const failure = [roomsRes, assignmentsRes].find((r) => r.error)
  if (failure?.error) {
    return (
      <Card className="border-danger/40 bg-tint-danger">
        <CardBody className="py-3 text-sm text-danger">{friendlyDbError(failure.error)}</CardBody>
      </Card>
    )
  }

  type AssignmentJoin = {
    room_id: string
    guest_id: string
    guests: { full_name: string } | null
    guest_groups: { head_name: string } | null
  }

  const occupantsByRoom = new Map<string, RoomRow['occupants']>()
  for (const a of (assignmentsRes.data ?? []) as unknown as AssignmentJoin[]) {
    const list = occupantsByRoom.get(a.room_id) ?? []
    list.push({
      guestId: a.guest_id,
      name: a.guests?.full_name ?? 'Unnamed guest',
      familyName: a.guest_groups?.head_name ?? '—',
    })
    occupantsByRoom.set(a.room_id, list)
  }

  const rooms: RoomRow[] = (roomsRes.data ?? [])
    .map((r) => ({
      id: r.id,
      roomNumber: r.room_number,
      roomType: r.room_type,
      capacity: r.capacity,
      floor: r.floor,
      occupants: (occupantsByRoom.get(r.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    }))
    // Numeric-aware, so 9 sorts before 10 rather than after it.
    .sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }))

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link
          href={`/admin/hotels?event=${encodeURIComponent(selected.code)}`}
          className="tap -ml-2 inline-flex w-fit items-center gap-1 rounded-xl px-2 py-1.5 text-sm font-medium text-muted hover:bg-surface-2 hover:text-fg"
        >
          <ChevronLeftIcon className="h-5 w-5" />
          Hotels
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-fg">{hotel.name}</h1>
        <p className="text-sm text-muted">
          {rooms.length} room{rooms.length === 1 ? '' : 's'} ·{' '}
          {rooms.reduce((n, r) => n + r.capacity, 0)} beds
        </p>
      </div>

      <AddRooms
        hotelId={hotel.id}
        eventId={selected.id}
        eventCode={selected.code}
        existingNumbers={rooms.map((r) => r.roomNumber)}
      />

      <RoomImport hotelId={hotel.id} eventId={selected.id} eventCode={selected.code} />

      <RoomList
        hotelId={hotel.id}
        hotelName={hotel.name}
        eventId={selected.id}
        eventCode={selected.code}
        rooms={rooms}
      />
    </div>
  )
}
