import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { resolveEventByCode } from '@/lib/supabase/queries'
import { RoomEditClient } from './_components/RoomEditClient'

export const metadata: Metadata = { title: 'Edit room' }

type PageProps = { params: Promise<{ eventCode: string; hotelId: string; roomId: string }> }

export function generateStaticParams(): Array<Record<string, string>> {
  return []
}

export default async function RoomEditPage({ params }: PageProps) {
  const { eventCode, hotelId, roomId } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  const supabase = await createClient()
  const { data: room } = await supabase
    .from('rooms')
    .select('room_number, room_type, floor, capacity, notes, is_blocked')
    .eq('id', roomId)
    .eq('event_id', event.id)
    .single()

  if (!room) notFound()

  return (
    <RoomEditClient
      roomId={roomId}
      eventId={event.id}
      eventCode={event.code}
      hotelId={hotelId}
      initial={{
        roomNumber: room.room_number,
        roomType: room.room_type,
        floor: room.floor,
        capacity: room.capacity,
        notes: room.notes,
        isBlocked: room.is_blocked,
      }}
    />
  )
}
