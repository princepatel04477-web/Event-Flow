import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'

import { SectionTabs } from '@/components/nav/SectionTabs'
import { requireSection } from '@/lib/auth/section-guard'
import { getEventAccess, resolveEventByCode } from '@/lib/supabase/queries'

type Props = {
  children: ReactNode
  params: Promise<{ eventCode: string }>
}

/**
 * The v2 guests section: the same guard as the legacy layout, plus the strip the
 * new shell does not draw.
 *
 * WHY THIS IS NOT A RE-EXPORT ANY MORE. The legacy `guests/layout.tsx` only
 * guards; in v1 the LIST | IMPORT | EXPORT strip is rendered by the `(staff)`
 * shell (`SectionTabs` in `(staff)/[eventCode]/layout.tsx`). The v2 shell draws
 * its own bottom bar and no strip, so under `NEXT_PUBLIC_UI=v2` those three
 * screens had no links between them at all. Find reaches the guest list, but
 * nothing reached import or export — the export job could not be started without
 * typing the URL, and inside the APK there is no URL bar (`docs/BUGS.md` M33).
 *
 * A CLIENT IS ALLOWED THROUGH, AND MUST BE — the same reason the legacy layout
 * carries the long note: `requireSection` starts with `requireStaff`, and
 * `requireStaff` sends a client to `/{event}/guests`, which is the page this
 * layout wraps. A client gets no strip (they have one screen), which is what
 * `SectionTabs` would decide anyway; branching here keeps `requireSection` off
 * their path entirely.
 */
export default async function GuestsSectionLayout({ children, params }: Props) {
  const { eventCode } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  const access = await getEventAccess(event.id)
  if (access === 'client') return <>{children}</>

  const ctx = await requireSection(event.id, event.code, 'guests')

  return (
    <>
      {/* Renders nothing for a runner (their bottom bar is already their own
          section's screens) and nothing for a section with fewer than two
          reachable children. The viewers who see it are `SECTIONS.guests`'
          two roles: admin and management. */}
      <SectionTabs eventCode={event.code} access={ctx.access} department={ctx.department} />
      {children}
    </>
  )
}
