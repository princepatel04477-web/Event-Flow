import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { resolveEventByCode, requireStaff } from '@/lib/supabase/queries'
import { RoomCreateForm } from '@/app/(admin)/admin/events/[eventCode]/hotels/[hotelId]/rooms/_components/RoomCreateForm'

export const metadata: Metadata = { title: 'Add rooms' }

type PageProps = { params: Promise<{ eventCode: string; hotelId: string }> }

/**
 * Staff room creation. Reuses the admin RoomCreateForm rather than growing a
 * second form — two copies of a create form drift, and the range/single modes
 * plus the padded numbering are exactly the parts you do not want two of.
 *
 * `backHref` points back into the staff tree: the form's default is the admin
 * hotel page, and sending an event_team user there on success would bounce
 * them to `/` through the (admin) layout guard immediately after a good write.
 *
 * requireStaff, not requireAdmin — `createRooms` already accepts event_team.
 */
export default async function StaffRoomCreatePage({ params }: PageProps) {
  const { eventCode, hotelId } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  await requireStaff(event.id, event.code)

  const supabase = await createClient()
  const { data: hotel } = await supabase
    .from('hotels')
    .select('name')
    .eq('id', hotelId)
    .eq('event_id', event.id)
    .maybeSingle()

  if (!hotel) notFound()

  return (
    <RoomCreateForm
      eventId={event.id}
      hotelId={hotelId}
      eventCode={event.code}
      hotelName={hotel.name}
      backHref={`/${event.code}/hospitality/rooms`}
    />
  )
}
