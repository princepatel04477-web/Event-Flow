import { allocate, type AllocationResult } from '@/lib/allocate/allocator'
import type {
  GroupForAllocation,
  GuestForAllocation,
  RoomForAllocation,
} from '@/lib/allocate/allocator'
import { readAllocationData, type AllocationData } from '@/lib/actions/rooms'

/**
 * Runs the allocator on the server and returns the proposal.
 * Does NOT write anything — the client calls this, reviews, then commits
 * separately via commitAllocations().
 */
export async function runAllocation(eventId: string): Promise<AllocationResult> {
  const data = await readAllocationData(eventId)
  const { groups, rooms } = adaptData(data)
  return allocate(groups, rooms)
}

/** Convert AllocationData from the wire shape to allocator input types. */
export function adaptData(data: AllocationData): {
  groups: GroupForAllocation[]
  rooms: RoomForAllocation[]
} {
  const groups: GroupForAllocation[] = data.groups.map((g) => ({
    id: g.id,
    headName: g.headName,
    groupType: g.groupType as GroupForAllocation['groupType'],
    side: g.side as GroupForAllocation['side'],
    expectedPax: g.expectedPax,
    confirmedPax: g.confirmedPax,
    priority: g.priority,
    guests: data.guests
      .filter((guest) => g.guestIds.includes(guest.id))
      .map(
        (guest): GuestForAllocation => ({
          id: guest.id,
          group_id: guest.groupId,
          is_head: guest.isHead,
          age_band: guest.ageBand as GuestForAllocation['age_band'],
        }),
      ),
    existingRoomIds: g.existingRoomIds,
  }))

  const rooms: RoomForAllocation[] = data.rooms

  return { groups, rooms }
}
