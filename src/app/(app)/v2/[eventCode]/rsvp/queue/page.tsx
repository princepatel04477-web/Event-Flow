import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { requireSection } from '@/lib/auth/section-guard'
import { getViewer, resolveEventByCode } from '@/lib/supabase/queries'

import { CallNext } from './CallNext'

export const metadata: Metadata = {
  title: 'Calls',
}

type PageProps = {
  // Next 15+ hands params over as a Promise.
  params: Promise<{ eventCode: string }>
}

/**
 * Job 1 of the v2 rebuild: call the next family, and log what happened on the
 * same screen.
 *
 * THE GUARD IS COPIED, NOT ASSUMED. The v1 screen is guarded twice over — the
 * shell layout resolves the event and the role, and
 * `(staff)/[eventCode]/rsvp/layout.tsx` then calls
 * `requireSection(event.id, event.code, 'rsvp')`, which is what keeps a
 * hospitality or travel runner (and a client) out of the calling list. That
 * section layout lives in the OTHER route group, so nothing under
 * `(app)/v2/` inherits it: every v2 page has to run the section guard itself
 * or it is a quieter, wider door onto the same data.
 *
 * `requireSection` resolves the event again internally (it takes the id, not
 * the row), which is the same double resolution the v1 tree pays — see the V4
 * entry in DECISIONS.md for why that is cheap on a code-auth session and where
 * the real cost on this path is.
 */
export default async function CallNextPage({ params }: PageProps) {
  const { eventCode } = await params

  const [event, viewer] = await Promise.all([
    resolveEventByCode(eventCode),
    getViewer(),
  ])
  if (!event) notFound()

  // Staff on this event AND a department allowed into the RSVP section.
  await requireSection(event.id, event.code, 'rsvp')

  return (
    <CallNext
      eventId={event.id}
      eventCode={event.code}
      startsOn={event.starts_on}
      endsOn={event.ends_on}
      isAdmin={viewer?.isAdmin ?? false}
    />
  )
}
