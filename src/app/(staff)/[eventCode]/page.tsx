import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { StatCard } from '@/components/dashboard/StatCard'
import {
  ArrowDownCircleIcon,
  ArrowUpCircleIcon,
  BoxIcon,
  CheckCircleIcon,
  ClockIcon,
  GiftIcon,
  ShieldAlertIcon,
  UserIcon,
  UsersIcon,
} from '@/components/icons'
import { EmptyState } from '@/components/ui/EmptyState'
import { createClient } from '@/lib/supabase/server'
import { getEventByCode } from '@/lib/supabase/queries'
import { count, formatCount } from '@/lib/utils'

export const metadata: Metadata = {
  title: 'Dashboard',
}

type PageProps = {
  // Next 15+ hands params over as a Promise.
  params: Promise<{ eventCode: string }>
}

export default async function EventDashboardPage({ params }: PageProps) {
  const { eventCode } = await params

  const event = (await getEventByCode(eventCode)) ?? (await getEventByCode(eventCode.toUpperCase()))
  if (!event) notFound()

  const supabase = await createClient()

  // v_event_dashboard is security_invoker = true, so this runs under the
  // viewer's own RLS. A client login gets zero rows here — which is the point.
  const { data: stats } = await supabase
    .from('v_event_dashboard')
    .select('*')
    .eq('event_id', event.id)
    .maybeSingle()

  if (!stats) {
    return (
      <EmptyState
        icon={<ShieldAlertIcon className="h-7 w-7" />}
        title="No numbers to show"
        description="This event has no dashboard row you can read. Usually that means your account is on the event as a client rather than as staff — ask an admin to check your role."
      />
    )
  }

  const totalGroups = count(stats.total_groups)

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold text-fg">Today at a glance</h2>
        <p className="mt-0.5 text-sm text-muted">
          Read live from the database on every visit.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Total groups"
          value={stats.total_groups}
          icon={<UsersIcon className="h-5 w-5" />}
          note="families on the list"
        />
        <StatCard
          label="Total pax"
          value={stats.total_pax}
          icon={<UserIcon className="h-5 w-5" />}
          note="confirmed, else expected"
        />

        <StatCard
          label="RSVP confirmed"
          value={stats.rsvp_confirmed}
          tone="success"
          icon={<CheckCircleIcon className="h-5 w-5" />}
          note={totalGroups > 0 ? `of ${formatCount(totalGroups)} groups` : undefined}
        />
        <StatCard
          label="RSVP pending"
          value={stats.rsvp_pending}
          tone="warning"
          icon={<ClockIcon className="h-5 w-5" />}
          note="not started, attempted, callback, tentative"
        />

        <StatCard
          label="Arrivals today"
          value={stats.arrivals_today}
          tone="info"
          icon={<ArrowDownCircleIcon className="h-5 w-5" />}
          note="travel legs dated today"
        />
        <StatCard
          label="Departures today"
          value={stats.departures_today}
          tone="info"
          icon={<ArrowUpCircleIcon className="h-5 w-5" />}
          note="travel legs dated today"
        />

        <StatCard
          label="Hampers delivered"
          value={stats.hampers_delivered}
          tone="success"
          icon={<GiftIcon className="h-5 w-5" />}
          note="photo proof on file"
        />
        <StatCard
          label="Hampers pending"
          value={stats.hampers_pending}
          tone="warning"
          icon={<BoxIcon className="h-5 w-5" />}
          note="not yet delivered"
        />
      </div>

      <p className="text-xs leading-relaxed text-subtle">
        Counters come from <code className="font-mono">v_event_dashboard</code> and respect
        your access. A zero here can mean &quot;nothing yet&quot; or &quot;not visible to
        you&quot; — it never means the query failed.
      </p>
    </div>
  )
}
