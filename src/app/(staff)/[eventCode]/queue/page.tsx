import type { Metadata } from 'next'
import { Suspense } from 'react'
import { notFound } from 'next/navigation'

import { Spinner } from '@/components/ui/Spinner'
import { requireStaff, resolveEventByCode } from '@/lib/supabase/queries'
import { QueueBoard } from './QueueBoard'

export const metadata: Metadata = {
  title: 'Calling Queue',
}

type PageProps = {
  // Next 15+ hands params over as a Promise.
  params: Promise<{ eventCode: string }>
}

export default async function QueuePage({ params }: PageProps) {
  const { eventCode } = await params

  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  // Staff only. `v_rsvp_queue` is security_invoker = true, so a client's read
  // comes back as zero rows with NO error — indistinguishable from an empty
  // queue. Left unguarded, the board would tell a client "Nothing to call yet
  // — import the guest list" about a wedding with 238 families already loaded.
  const access = await requireStaff(event.id, event.code)

  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-12">
          <Spinner size="lg" />
        </div>
      }
    >
      <QueueBoard
        eventId={event.id}
        eventCode={event.code}
        // Import is admin-only (see import/page.tsx). Offering the CTA to an
        // event_team member would bounce them straight back off requireAdmin.
        canImport={access === 'admin'}
      />
    </Suspense>
  )
}
