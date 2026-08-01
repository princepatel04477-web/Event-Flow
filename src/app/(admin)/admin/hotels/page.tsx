import type { Metadata } from 'next'
import Link from 'next/link'

import { EventPicker } from '@/components/admin/EventPicker'
import { Card, CardBody } from '@/components/ui/Card'
import { friendlyDbError } from '@/lib/errors'
import { resolveAdminEvent } from '@/lib/events/adminEvent'
import { createClient } from '@/lib/supabase/server'

import { HotelManager, type HotelRow } from './HotelManager'

export const metadata: Metadata = {
  title: 'Hotels',
}

type PageProps = {
  searchParams: Promise<{ event?: string }>
}

/**
 * /admin/hotels — the hotels booked for one event, and their room counts.
 *
 * Admin-only by inheritance: the `(admin)` layout has already established
 * `global_role = 'admin'` before this renders.
 */
export default async function AdminHotelsPage({ searchParams }: PageProps) {
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
        basePath="/admin/hotels"
        title="Hotels"
        description="Pick an event to manage its hotels and rooms."
      />
    )
  }

  const supabase = await createClient()

  // Rooms are read separately and folded in, rather than joined, so the
  // counts stay correct when a hotel has no rooms at all.
  const [hotelsRes, roomsRes] = await Promise.all([
    supabase
      .from('hotels')
      .select('id, name, address, contact_name, contact_mobile, notes')
      .eq('event_id', selected.id)
      .order('name', { ascending: true }),
    supabase.from('rooms').select('hotel_id, capacity').eq('event_id', selected.id),
  ])

  const failure = [hotelsRes, roomsRes].find((r) => r.error)
  if (failure?.error) {
    return (
      <Card className="border-danger/40 bg-tint-danger">
        <CardBody className="py-3 text-sm text-danger">{friendlyDbError(failure.error)}</CardBody>
      </Card>
    )
  }

  const roomCounts = new Map<string, { rooms: number; beds: number }>()
  for (const room of roomsRes.data ?? []) {
    const current = roomCounts.get(room.hotel_id) ?? { rooms: 0, beds: 0 }
    current.rooms += 1
    current.beds += room.capacity
    roomCounts.set(room.hotel_id, current)
  }

  const hotels: HotelRow[] = (hotelsRes.data ?? []).map((h) => ({
    ...h,
    roomCount: roomCounts.get(h.id)?.rooms ?? 0,
    bedCount: roomCounts.get(h.id)?.beds ?? 0,
  }))

  return (
    <div className="flex flex-col gap-4">
      <div>
        {events.length > 1 ? (
          <Link
            href="/admin/hotels"
            className="tap -ml-2 inline-flex w-fit rounded-xl px-2 py-1.5 text-sm font-medium text-muted hover:bg-surface-2 hover:text-fg"
          >
            Change event
          </Link>
        ) : null}
        <h1 className="mt-1 text-lg font-semibold text-fg">Hotels</h1>
        <p className="text-sm text-muted">
          {selected.name} · {selected.code}
        </p>
      </div>

      <HotelManager eventId={selected.id} eventCode={selected.code} hotels={hotels} />
    </div>
  )
}
