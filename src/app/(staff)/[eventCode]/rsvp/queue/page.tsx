import type { Metadata } from 'next'
import { Suspense } from 'react'
import { notFound } from 'next/navigation'

import { Spinner } from '@/components/ui/Spinner'
import { createClient } from '@/lib/supabase/server'
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

  // Ground truth for the board's empty state, counted here because only the
  // server can obtain it: this session has already passed `requireStaff`, so
  // a zero here means the event really is empty, while a zero on the client
  // may only mean the client's own read was refused. `head: true` fetches no
  // rows — it is a count query, not a second copy of the queue.
  //
  // A failed count is deliberately NOT treated as zero. Coalescing the error
  // to 0 would re-create the exact bug this is here to close, just one layer
  // further back; -1 is carried through as "unknown", and the board falls
  // back to its old wording rather than inventing a number.
  const supabase = await createClient()
  const { count, error: countError } = await supabase
    .from('guest_groups')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', event.id)

  const knownGroupCount = countError ? -1 : (count ?? -1)

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
        knownGroupCount={knownGroupCount}
      />
    </Suspense>
  )
}
