import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

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
 */
export function generateStaticParams(): Array<Record<string, string>> {
  return [{}]
}

export default async function AllocatePage({ params }: PageProps) {
  const { eventCode } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  await requireStaff(event.id, event.code)

  const data = await readAllocationData(event.id)

  return <AllocateClient eventId={event.id} eventCode={event.code} data={data} />
}
