import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { resolveEventByCode, requireStaff } from '@/lib/supabase/queries'
import { EmptyState } from '@/components/ui/EmptyState'
import { Row } from '@/components/ui/Row'
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
      {/* A body subtitle, not a second screen title: under the v3 shell the
          header already says "Rooms", and the v1 shell names only the event.
          Keeping it at 20px Bricolage makes it read as "which screen am I on
          in this section" in both, without two competing 30px titles. */}
      <div className="min-w-0">
        <h2 className="font-display text-xl leading-tight font-semibold text-ink">Add rooms</h2>
        <p className="mt-1 text-sm leading-snug text-muted">
          Rooms belong to a hotel. Pick the one to add them to.
        </p>
      </div>

      <ul className="overflow-hidden rounded-2xl border border-rule-strong bg-surface">
        {hotels.map((hotel) => (
          <li key={hotel.id}>
            <Link
              href={`/${event.code}/hospitality/rooms/new/${hotel.id}`}
              className="tap block transition-colors duration-press ease-ledger active:bg-surface-2"
            >
              <Row
                heading={hotel.name}
                meta={hotel.address ?? undefined}
                badge={
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-tint text-brand">
                    <BuildingIcon className="h-5 w-5" />
                  </span>
                }
                trailing={<ChevronRightIcon className="h-5 w-5" />}
              />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
