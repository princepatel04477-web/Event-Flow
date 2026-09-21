import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { getStaffViewerContext } from '@/lib/auth/section-guard'
import { DEPARTMENT_LABELS } from '@/lib/departments'
import { bottomTabsFor } from '@/lib/sections/config'
import { requireStaff, resolveEventByCode } from '@/lib/supabase/queries'

import { HelpScreen } from './HelpScreen'

export const metadata: Metadata = {
  title: 'How this app works',
}

type PageProps = {
  // Next 15+ hands params over as a Promise.
  params: Promise<{ eventCode: string }>
}

/**
 * The cheat sheet, reached from the "?" control in the header.
 *
 * ── No new data, and no new nav model ─────────────────────────────────────
 * The rows are `bottomTabsFor(event.code, access, department)` — the same call
 * the shell's bottom bar makes, with the values the page's own guard has
 * already resolved. So the sheet cannot describe an app other than the one the
 * reader is holding, and it needs no read of its own. Nothing here touches a
 * table.
 *
 * ── Why it is a route ─────────────────────────────────────────────────────
 * The header control has to be a LINK: a staff member helping another staff
 * member needs to be able to say "open /SHARMA26/help", and a control that
 * opens a client-side sheet has no address to say. It renders inside the shell,
 * so the reader keeps their tabs and the header's back control — R3's rule that
 * a screen is never a dead end.
 *
 * ── Why `requireStaff` is not optional here ───────────────────────────────
 * The header withholds the control from a client, but a URL is typing distance
 * away. A client reaching this page would be shown a nav model they do not have
 * — a fabricated answer about a staff app — so `requireStaff` bounces them to
 * the one screen a client owns. RLS is still the fence; this is honesty.
 */
export default async function HelpPage({ params }: PageProps) {
  const { eventCode } = await params

  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  const access = await requireStaff(event.id, event.code)
  const staffCtx = await getStaffViewerContext(event.id)
  const department = staffCtx?.department ?? null

  const tabs = bottomTabsFor(event.code, access, department)

  return (
    <HelpScreen
      tabs={tabs}
      departmentLabel={department ? DEPARTMENT_LABELS[department] : 'Event lead'}
    />
  )
}
