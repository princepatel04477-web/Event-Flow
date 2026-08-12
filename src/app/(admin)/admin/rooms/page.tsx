import type { Metadata } from 'next'
import Link from 'next/link'

import { EventPicker } from '@/components/admin/EventPicker'
import { Card, CardBody } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { LinkButton } from '@/components/ui/LinkButton'
import { friendlyDbError } from '@/lib/errors'
import { resolveAdminEvent } from '@/lib/events/adminEvent'
import { createClient } from '@/lib/supabase/server'

import { RoomGrid, type GridRoom, type UnplacedGuest } from './RoomGrid'

export const metadata: Metadata = {
  title: 'Rooms',
}

type PageProps = {
  searchParams: Promise<{ event?: string }>
}

/**
 * /admin/rooms — the manual override grid, used most on the day itself.
 *
 * Everything here is two taps: pick a guest, pick a room. No drag and drop —
 * it is unusable on a phone, and the team is on phones.
 */
export default async function RoomsPage({ searchParams }: PageProps) {
  const { event: eventCode } = await searchParams
  const { events, selected, error } = await resolveAdminEvent(eventCode)

  if (error) {
    return (
      <Card className="border-danger/40 bg-tint-danger">
        <CardBody className="py-3 text-sm text-danger">{error}</CardBody>
      </Card>
    )
  }

  if (!selected) {
    return (
      <EventPicker
        events={events}
        basePath="/admin/rooms"
        title="Rooms"
        description="Pick an event to see its room grid."
      />
    )
  }

  const supabase = await createClient()

  const [roomsRes, assignmentsRes, guestsRes] = await Promise.all([
    supabase
      .from('rooms')
      .select('id, hotel_id, room_number, room_type, capacity, is_blocked, hotels(name)')
      .eq('event_id', selected.id),
    supabase
      .from('room_assignments')
      .select('room_id, guest_id, group_id, is_override, guests(full_name), guest_groups(head_name)')
      .eq('event_id', selected.id)
      .is('released_at', null),
    // Only confirmed families: anyone still tentative would be shown as
    // "needs a room" when in fact they may not be coming.
    supabase
      .from('guests')
      .select('id, group_id, full_name, guest_groups!inner(head_name, rsvp_status)')
      .eq('event_id', selected.id)
      .eq('guest_groups.rsvp_status', 'confirmed'),
  ])

  const failure = [roomsRes, assignmentsRes, guestsRes].find((r) => r.error)
  if (failure?.error) {
    return (
      <Card className="border-danger/40 bg-tint-danger">
        <CardBody className="py-3 text-sm text-danger">{friendlyDbError(failure.error)}</CardBody>
      </Card>
    )
  }

  type RoomJoin = {
    id: string
    hotel_id: string
    room_number: string
    room_type: string | null
    capacity: number
    is_blocked: boolean
    hotels: { name: string } | null
  }
  type AssignmentJoin = {
    room_id: string
    guest_id: string
    group_id: string
    is_override: boolean
    guests: { full_name: string } | null
    guest_groups: { head_name: string } | null
  }
  type GuestJoin = {
    id: string
    group_id: string
    full_name: string
    guest_groups: { head_name: string; rsvp_status: string } | null
  }

  const assignments = (assignmentsRes.data ?? []) as unknown as AssignmentJoin[]

  const occupantsByRoom = new Map<string, GridRoom['occupants']>()
  const placedGuestIds = new Set<string>()
  for (const a of assignments) {
    placedGuestIds.add(a.guest_id)
    const list = occupantsByRoom.get(a.room_id) ?? []
    list.push({
      guestId: a.guest_id,
      groupId: a.group_id,
      name: a.guests?.full_name ?? 'Unnamed guest',
      familyName: a.guest_groups?.head_name ?? '—',
      isOverride: a.is_override,
    })
    occupantsByRoom.set(a.room_id, list)
  }

  const rooms: GridRoom[] = ((roomsRes.data ?? []) as unknown as RoomJoin[])
    .map((r) => ({
      id: r.id,
      hotelId: r.hotel_id,
      hotelName: r.hotels?.name ?? 'Unknown hotel',
      roomNumber: r.room_number,
      roomType: r.room_type,
      capacity: r.capacity,
      isBlocked: r.is_blocked,
      occupants: (occupantsByRoom.get(r.id) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort(
      (a, b) =>
        a.hotelName.localeCompare(b.hotelName) ||
        a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }),
    )

  const unplaced: UnplacedGuest[] = ((guestsRes.data ?? []) as unknown as GuestJoin[])
    .filter((g) => !placedGuestIds.has(g.id))
    .map((g) => ({
      guestId: g.id,
      groupId: g.group_id,
      name: g.full_name,
      familyName: g.guest_groups?.head_name ?? '—',
    }))
    .sort((a, b) => a.familyName.localeCompare(b.familyName) || a.name.localeCompare(b.name))

  const totalBeds = rooms.reduce((n, r) => n + r.capacity, 0)
  const taken = assignments.length

  return (
    <div className="flex flex-col gap-4">
      <div>
        {events.length > 1 ? (
          <Link
            href="/admin/rooms"
            className="tap -ml-2 inline-flex w-fit rounded-xl px-2 py-1.5 text-sm font-medium text-muted hover:bg-surface-2 hover:text-fg"
          >
            Change event
          </Link>
        ) : null}
        <h1 className="mt-1 text-lg font-semibold text-fg">Rooms</h1>
        <p className="text-sm text-muted">
          {taken} of {totalBeds} beds taken · {rooms.length} rooms
        </p>
      </div>

      {rooms.length === 0 ? (
        <>
          <EmptyState
            title="No rooms yet"
            description="Set up hotels and their rooms first, then come back to allocate."
          />
          <LinkButton
            href={`/admin/hotels?event=${encodeURIComponent(selected.code)}`}
            size="lg"
            fullWidth
          >
            Set up hotels and rooms
          </LinkButton>
        </>
      ) : (
        <>
          <LinkButton
            href={`/admin/rooms/allocate?event=${encodeURIComponent(selected.code)}`}
            size="lg"
            fullWidth
          >
            Propose an allocation
          </LinkButton>

          <RoomGrid
            eventId={selected.id}
            eventCode={selected.code}
            rooms={rooms}
            unplaced={unplaced}
          />
        </>
      )}
    </div>
  )
}
