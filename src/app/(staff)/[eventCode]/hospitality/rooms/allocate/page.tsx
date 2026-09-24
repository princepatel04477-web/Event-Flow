import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ReadFailure } from '@/components/ui/ReadFailure'
import { resolveEventByCode, requireStaff } from '@/lib/supabase/queries'
import { readAllocationData } from '@/lib/actions/rooms'

import { AllocateClient } from './AllocateClient'

export const metadata: Metadata = {
  title: 'Room allocation',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
}

/**
 * Room allocation proposal page.
 *
 * Shows a greedy allocation plan grouped by family. Writes NOTHING until
 * the user reviews and presses Commit — the allocator is a pure function
 * run on the server, and committing is a separate action.
 *
 * A FAILED READ IS NOT AN EMPTY EVENT (M15). `readAllocationData` discarded
 * every read's `error`, and the allocator answers `{ok:false, error:'No rooms
 * have been added to this event yet.'}` for an empty room list — so a dropped
 * connection rendered as an instruction to create rooms that already exist. The
 * read now reports its failure and this page says so instead of planning a
 * wedding with no rooms in it.
 */
export default async function AllocatePage({ params }: PageProps) {
  const { eventCode } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  await requireStaff(event.id, event.code)

  const data = await readAllocationData(event.id)

  if (data.error) {
    return <ReadFailure what="the rooms and families to allocate" />
  }

  return <AllocateClient eventId={event.id} eventCode={event.code} data={data} />
}
