import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { resolveEventByCode, requireStaff } from '@/lib/supabase/queries'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageTitle } from '@/components/ui/PageTitle'
import { BuildingIcon, ChevronRightIcon } from '@/components/icons'

export const metadata: Metadata = { title: 'Add rooms' }

type PageProps = { params: Promise<{ eventCode: string }> }

/**
 * Pick a hotel to add rooms to — the staff entry point to room creation.
 *
 * Room creation existed only under `(admin)/admin/events/**`, whose layout
 * does `if (!viewer.isAdmin) redirect('/')`. So an event_team session could
 * not reach it at all: not gated in the UI, not refused by the action —
 * simply no route. `createRooms` has always accepted event_team via
 * `staffGate`, so this adds a route, not a permission.
 *
 * That matters tomorrow rather than eventually: hotels without rooms means no
 * allocation, no check-in, and nothing downstream of either.
 */
export default async function StaffRoomCreatePickerPage({ params }: PageProps) {
  const { eventCode } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  await requireStaff(event.id, event.code)

  const supabase = await createClient()
  const { data: hotels, error } = await supabase
    .from('hotels')
    .select('id, name, address')
    .eq('event_id', event.id)
    .order('name')

  if (error) {
    return (
      <EmptyState
        icon={<BuildingIcon className="h-7 w-7" />}
        title="Could not load hotels"
        description={error.message}
      />
    )
  }

  if (!hotels || hotels.length === 0) {
    return (
      <EmptyState
        icon={<BuildingIcon className="h-7 w-7" />}
        title="No hotels yet"
        description="Rooms belong to a hotel, and this event has none. An admin adds hotels; ask them to set one up first."
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <PageTitle>Add rooms</PageTitle>
      <p className="text-sm text-muted">Pick the hotel these rooms belong to.</p>

      <div className="flex flex-col gap-3">
        {hotels.map((hotel) => (
          <Link
            key={hotel.id}
            href={`/${event.code}/hospitality/rooms/new/${hotel.id}`}
            className="tap flex items-center gap-3 rounded-xl border border-rule bg-surface p-4 transition-colors hover:bg-surface-2 active:bg-surface-2"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-tint text-brand">
              <BuildingIcon className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-fg">{hotel.name}</p>
              {hotel.address ? (
                <p className="truncate text-sm text-muted">{hotel.address}</p>
              ) : null}
            </div>
            <ChevronRightIcon className="h-5 w-5 shrink-0 text-muted" />
          </Link>
        ))}
      </div>
    </div>
  )
}
