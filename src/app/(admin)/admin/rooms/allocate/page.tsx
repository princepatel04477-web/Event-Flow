import type { Metadata } from 'next'
import Link from 'next/link'

import { EventPicker } from '@/components/admin/EventPicker'
import { ChevronLeftIcon } from '@/components/icons'
import { Card, CardBody } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { LinkButton } from '@/components/ui/LinkButton'
import { resolveAdminEvent } from '@/lib/events/adminEvent'
import { loadAllocationPlan } from '@/lib/rooms/loadAllocation'

import { AllocationProposal } from './AllocationProposal'

export const metadata: Metadata = {
  title: 'Allocate rooms',
}

type PageProps = {
  searchParams: Promise<{ event?: string }>
}

/**
 * /admin/rooms/allocate — the allocator proposes, a human commits.
 *
 * The plan is computed on every render rather than stored. It is cheap
 * (milliseconds for 238 families) and it means the proposal always reflects
 * the rooms and RSVPs as they are right now, not as they were when somebody
 * last opened the page.
 */
export default async function AllocatePage({ searchParams }: PageProps) {
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
        basePath="/admin/rooms/allocate"
        title="Allocate rooms"
        description="Pick an event to propose an allocation."
      />
    )
  }

  const loaded = await loadAllocationPlan(selected.id)

  const header = (
    <div>
      <Link
        href={`/admin/rooms?event=${encodeURIComponent(selected.code)}`}
        className="tap -ml-2 inline-flex w-fit items-center gap-1 rounded-xl px-2 py-1.5 text-sm font-medium text-muted hover:bg-surface-2 hover:text-fg"
      >
        <ChevronLeftIcon className="h-5 w-5" />
        Room grid
      </Link>
      <h1 className="mt-1 text-lg font-semibold text-fg">Proposed allocation</h1>
      <p className="text-sm text-muted">
        {selected.name} · {selected.code}
      </p>
    </div>
  )

  if (loaded.error) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <Card className="border-danger/40 bg-tint-danger">
          <CardBody className="py-3 text-sm text-danger">{loaded.error}</CardBody>
        </Card>
      </div>
    )
  }

  const { plan } = loaded
  const nothingToDo =
    plan.placements.length === 0 &&
    plan.unplaced.length === 0 &&
    loaded.familiesWithoutGuests.length === 0

  if (nothingToDo) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <EmptyState
          title={
            loaded.fullyPlaced > 0 ? 'Everybody confirmed already has a room' : 'Nothing to allocate'
          }
          description={
            loaded.fullyPlaced > 0
              ? `All ${loaded.fullyPlaced} confirmed families are placed. Run this again after more RSVPs come in.`
              : 'No families have an RSVP of "confirmed" yet, so there is nobody to place. Rooms are only allocated to confirmed guests.'
          }
        />
        <LinkButton
          href={`/admin/rooms?event=${encodeURIComponent(selected.code)}`}
          size="lg"
          fullWidth
          variant="secondary"
        >
          Open the room grid
        </LinkButton>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {header}
      <AllocationProposal
        eventId={selected.id}
        eventCode={selected.code}
        plan={plan}
        fullyPlaced={loaded.fullyPlaced}
        familiesWithoutGuests={loaded.familiesWithoutGuests}
      />
    </div>
  )
}
