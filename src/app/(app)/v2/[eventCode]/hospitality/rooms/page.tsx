import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { requireSection } from '@/lib/auth/section-guard'
import { sectionAllowedForDepartment } from '@/lib/departments'
import { getEventAccess, resolveEventByCode } from '@/lib/supabase/queries'

import { RoomsBoard } from './RoomsBoard'

export const metadata: Metadata = {
  title: 'Hospitality',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
}

/**
 * Job 2 of the v2 rebuild: the Rooms board.
 *
 * The section guard is run here rather than inherited, because it CANNOT be
 * inherited: `(staff)/[eventCode]/hospitality/layout.tsx` calls
 * `requireSection(..., 'hospitality')` and lives in the other route group, so
 * nothing under `(app)/v2/` passes through it. Without this line the only thing
 * standing between a travel runner and the room register would be the shell's
 * `requireStaff`.
 */
export default async function RoomsPage({ params }: PageProps) {
  const { eventCode } = await params

  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  const ctx = await requireSection(event.id, event.code, 'hospitality')

  // Whether the "Go to the call list" empty-state action may be offered.
  //
  // Answered HERE because only the guard knows: `hospitality` is not a member of
  // `DEPARTMENT_SECTIONS.rsvp`, so for the runner this screen is built for,
  // `rsvp/queue`'s own guard bounces them straight back to this page with
  // `?denied=section` — which this page does not read. The one button on the
  // empty state would do nothing at all, and "every family has a room" is where
  // a hospitality runner lands every time they clear their queue. Found by the
  // R1 review; `getEventAccess` is memoised per request, so re-reading it here
  // costs nothing.
  const access = await getEventAccess(event.id)
  const canOpenCallList =
    access === 'admin' || sectionAllowedForDepartment('rsvp', ctx.department)

  return (
    <RoomsBoard eventId={event.id} eventCode={event.code} canOpenCallList={canOpenCallList} />
  )
}
