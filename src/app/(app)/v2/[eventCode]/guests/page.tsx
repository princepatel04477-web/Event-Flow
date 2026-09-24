import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { getStaffViewerContext } from '@/lib/auth/section-guard'
import { mayOpenCallRecords } from '@/lib/departments'
import { getEventAccess, resolveEventByCode } from '@/lib/supabase/queries'

import { ClientGuestDirectory } from './_components/ClientGuestDirectory'
import { StaffGuestDirectory } from './_components/StaffGuestDirectory'

export const metadata: Metadata = {
  title: 'Guests',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
}

/**
 * The guest directory — one URL, two audiences, and NOT a `requireStaff` gate.
 *
 * DO NOT PUT `requireStaff` BACK ON THIS PAGE. It redirects a client to
 * `/{eventCode}/guests`, which is this page: the client's only permitted screen
 * bounced them at itself forever, and the loop surfaced as the event error
 * boundary ("This screen did not load"). This is the one route in the app
 * where the staff gate is the bug rather than the guard.
 *
 * ── What changed in v3 ─────────────────────────────────────────────────────
 * This route used to be a two-line re-export of the v1 screen
 * (`(staff)/[eventCode]/guests/page.tsx`), so a staff member reaching Guests
 * from the header's search button got the v2 windowed `ListRow`/`StatusPill`
 * list while every other screen was v3. SPEC-V3 §3 makes Guests and Find the
 * same screen behind two doors, so both now render the directory in
 * `_components/` — search field, Rows, guest sheet — and the v1 screens are
 * left alone for the v1 shell.
 *
 * ACCESS IS RESOLVED, NEVER GUESSED. `getEventAccess` is memoised per request,
 * so resolving it here after the layout already did costs nothing. It is still
 * not the fence: RLS is, and it is what makes the two components safe — a
 * client reaching the staff component would read nothing staff-only.
 */
export default async function GuestsPage({ params }: PageProps) {
  const { eventCode } = await params

  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  const access = await getEventAccess(event.id)

  // Unreachable in practice: `resolveEventByCode` runs under RLS and already
  // returned null for a non-member, so the shell 404'd before we got here.
  // Written down rather than assumed.
  if (access === 'none') notFound()

  if (access === 'client') {
    return <ClientGuestDirectory eventId={event.id} />
  }

  // Same server-side answer Find gets: this screen is reached from the header's
  // search button by every department, and the record it can open is not open to
  // all of them (`docs/BUGS.md` M3).
  const department = (await getStaffViewerContext(event.id))?.department ?? null

  return (
    <StaffGuestDirectory
      eventId={event.id}
      eventCode={event.code}
      from="guests"
      canOpenFamilyRecord={mayOpenCallRecords(access, department)}
    />
  )
}
