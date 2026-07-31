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
import { Card, CardBody } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { createClient } from '@/lib/supabase/server'
import {
  requireStaff,
  resolveEventByCode,
  type DeniedReason,
} from '@/lib/supabase/queries'
import { count, formatCount } from '@/lib/utils'

export const metadata: Metadata = {
  title: 'Dashboard',
}

/**
 * Messages for `?denied=`, looked up rather than read out of the URL.
 *
 * `requireAdmin` bounces an event_team member here, and a bounce with no
 * explanation reads as a broken link. The query string only ever selects a
 * key — the sentence itself is ours, so a crafted URL cannot put words in
 * the app's mouth.
 */
const DENIED_MESSAGES: Record<DeniedReason, string> = {
  import:
    'Importing the guest list is an admin job, so we brought you back here. Ask your event admin to run the import.',
  admin: 'That screen is admin-only, so we brought you back here.',
}

function deniedMessage(value: string | undefined): string | null {
  if (!value) return null
  return DENIED_MESSAGES[value as DeniedReason] ?? null
}

type PageProps = {
  // Next 15+ hands params and searchParams over as Promises.
  params: Promise<{ eventCode: string }>
  searchParams: Promise<{ denied?: string }>
}

export default async function EventDashboardPage({ params, searchParams }: PageProps) {
  const { eventCode } = await params
  const { denied } = await searchParams
  const deniedNote = deniedMessage(denied)

  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  // Staff only. Without this a client renders the whole board as zeros:
  // `v_event_dashboard` selects FROM `events`, whose RLS is
  // `using (app.is_member(id))` — TRUE for a client — while every counter is
  // a subquery over guest_groups / travel_legs / deliverables, all fenced by
  // `app.is_staff()` — FALSE for a client. So the read returns ONE row of
  // zeros, not zero rows, and the `!stats` fallback below never fires. The
  // client would be told "Total groups 0" for a 238-family wedding.
  await requireStaff(event.id, event.code)

  const supabase = await createClient()

  const { data: stats, error } = await supabase
    .from('v_event_dashboard')
    .select('*')
    .eq('event_id', event.id)
    .maybeSingle()

  // Reachable only as a genuine read failure now — the guard above has
  // already established the viewer is staff on this event.
  if (error || !stats) {
    return (
      <EmptyState
        icon={<ShieldAlertIcon className="h-7 w-7" />}
        title="Could not load the numbers"
        description="The dashboard counters did not come back from the database this time. This is a load failure, not an empty event — reload the page, and tell your admin if it keeps happening."
      />
    )
  }

  const totalGroups = count(stats.total_groups)

  return (
    <div className="flex flex-col gap-4">
      {deniedNote ? (
        <Card className="border-border-strong bg-surface-2">
          <CardBody className="flex items-start gap-2 py-3">
            <ShieldAlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-muted" />
            <p className="text-sm text-fg">{deniedNote}</p>
          </CardBody>
        </Card>
      ) : null}

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
        Counters are read live from the database on every visit. A zero here means
        nothing has been recorded yet — if a read fails you get a message instead of a
        number, never a silent zero.
      </p>
    </div>
  )
}
