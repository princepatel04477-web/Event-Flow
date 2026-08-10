import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { resolveEventByCode } from '@/lib/supabase/queries'
import { DashboardClient } from './DashboardClient'
import { Badge } from '@/components/ui/Badge'
import { ShieldAlertIcon } from '@/components/icons'

export const metadata: Metadata = {
  title: 'Dashboard',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
}

export default async function AdminEventDashboardPage({ params }: PageProps) {
  const { eventCode } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  const supabase = await createClient()
  const { count } = await supabase
    .from('staff_members')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', event.id)

  return (
    <>
      {count === 0 ? (
        <div className="mb-4 rounded-xl bg-tint-warning px-4 py-3 text-sm font-medium text-warning">
          No staff members on this event. Nobody can log in — add at least one name.
        </div>
      ) : null}
      <DashboardClient eventId={event.id} eventCode={event.code} />
    </>
  )
}
