import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { AttentionPanel } from '@/components/dashboard/AttentionPanel'
import { StatCard } from '@/components/dashboard/StatCard'
import { ShieldAlertIcon } from '@/components/icons'
import { EmptyState } from '@/components/ui/EmptyState'
import { readBoard } from '@/lib/actions/dashboard'
import {
  requireStaff,
  resolveEventByCode,
  type DeniedReason,
} from '@/lib/supabase/queries'
import { traceFetch } from '@/lib/perf'
import { count, formatCount } from '@/lib/utils'

export const metadata: Metadata = {
  title: 'Board',
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

  // Both reads go through the 30s TTL cache in dashboard.ts, and the
  // request-scoped Supabase client is shared, so a revisit renders from
  // memory instead of paying two ~150ms round-trips to the Supabase region.
  // ONE read, both panels. These used to be two reads of two views in
  // Promise.all — parallel, but still two round trips to Seoul for data that
  // now comes back as a single row (v_event_board). Calling readDashboard and
  // readAttention here would issue the underlying read twice: they are
  // separate entry points and the per-request memo does not span them.
  const board = await traceFetch('dashboard :: board', () => readBoard(event.id))
  const stats = board
  const attn = {
    confirmedNoRoom: board?.confirmedNoRoom ?? 0,
    arrivalsNoVehicle: board?.arrivalsNoVehicle ?? 0,
    noDeparture: board?.noDeparture ?? 0,
    hampersPending: board?.hampersPending ?? 0,
  }

  // Reachable only as a genuine read failure now — the guard above has
  // already established the viewer is staff on this event.
  if (!stats) {
    return (
      <EmptyState
        icon={<ShieldAlertIcon className="h-7 w-7" />}
        title="Could not load the numbers"
        description="The dashboard counters did not come back from the database this time. This is a load failure, not an empty event — reload the page, and tell your admin if it keeps happening."
      />
    )
  }

  const totalGroups = count(stats.totalGroups)
  const totalPax = count(stats.totalPax)
  const confirmed = count(stats.rsvpConfirmed)
  const pending = count(stats.rsvpPending)

  // The split bar under the headline figure. Percentages of GROUPS, because
  // that is what confirmed/pending count — mixing a pax numerator with a
  // group denominator is the classic way a dashboard lies.
  const confirmedPct = totalGroups > 0 ? (confirmed / totalGroups) * 100 : 0
  const pendingPct = totalGroups > 0 ? (pending / totalGroups) * 100 : 0

  return (
    <div className="flex flex-col gap-4">
      {deniedNote ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-rule-strong bg-surface px-3.5 py-3">
          <ShieldAlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-muted" />
          <p className="text-sm leading-snug text-ink">{deniedNote}</p>
        </div>
      ) : null}

      {/* The headline. One figure, the size of a thumb, and the split that
          explains it — this is the number someone shouts across a room. */}
      <section className="list-fade rounded-2xl border border-brand/25 bg-surface bg-[linear-gradient(158deg,var(--ef-brand-tint),transparent_62%)] p-4 shadow-[0_16px_40px_-22px_rgba(0,0,0,0.85)]">
        <h2 className="eyebrow text-brand">Total pax on the list</h2>

        <div className="mt-2 flex items-end gap-3">
          <span className="figure text-6xl leading-none font-medium tracking-tight text-ink">
            {formatCount(totalPax)}
          </span>
          <span className="pb-2 text-sm leading-snug text-muted">
            across
            <br />
            {formatCount(totalGroups)} families
          </span>
        </div>

        <div
          className="mt-3.5 flex h-1.5 overflow-hidden rounded-full bg-surface-2"
          role="img"
          aria-label={`${formatCount(confirmed)} of ${formatCount(totalGroups)} families confirmed, ${formatCount(pending)} still pending`}
        >
          <div className="grow-x bg-ledger-green" style={{ width: `${confirmedPct}%` }} />
          <div
            className="grow-x bg-brand"
            style={{ width: `${pendingPct}%`, animationDelay: '90ms' }}
          />
        </div>

        <div className="mt-2.5 flex gap-4 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 rounded-xs bg-ledger-green" />
            {formatCount(confirmed)} confirmed
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 rounded-xs bg-brand" />
            {formatCount(pending)} pending
          </span>
        </div>
      </section>

      {/* Every counter is a question, and the answer is on another screen —
          so every tile is the link to that screen. */}
      <div className="grid grid-cols-2 gap-2.5">
        <StatCard
          label="RSVP confirmed"
          value={confirmed}
          tone="success"
          note={totalGroups > 0 ? `of ${formatCount(totalGroups)} families` : undefined}
          href={`/${event.code}/queue`}
          style={{ animationDelay: '0ms' }}
        />
        <StatCard
          label="RSVP pending"
          value={pending}
          tone="warning"
          note="not started, attempted, callback, tentative"
          href={`/${event.code}/queue`}
          style={{ animationDelay: '40ms' }}
        />
        <StatCard
          label="Guests roomed"
          value={stats.guestsRoomed}
          note="have an active room assignment"
          href={`/${event.code}/rooms`}
          style={{ animationDelay: '80ms' }}
        />
        <StatCard
          label="Arrivals today"
          value={stats.arrivalsToday}
          note="travel legs dated today"
          href={`/${event.code}/arrivals`}
          style={{ animationDelay: '120ms' }}
        />
        <StatCard
          label="Hampers sealed"
          value={stats.hampersDelivered}
          tone="success"
          note="photo proof on file"
          href={`/${event.code}/deliveries`}
          style={{ animationDelay: '160ms' }}
        />
        <StatCard
          label="Hampers queued"
          value={stats.hampersPending}
          tone="info"
          note="no proof yet"
          href={`/${event.code}/deliveries`}
          style={{ animationDelay: '200ms' }}
        />
      </div>

      <AttentionPanel attn={attn} eventCode={event.code} />

      {/* Event-day screens that do not earn a tab slot but do get used all
          day once the guests are actually in the building. */}
      <nav aria-label="Event day" className="grid grid-cols-2 gap-2.5">
        {[
          { href: `/${event.code}/checkin`, label: 'Check in / out' },
          { href: `/${event.code}/departures`, label: 'Departures' },
          { href: `/${event.code}/rsvp`, label: 'RSVP logging' },
          { href: `/${event.code}/export`, label: 'Excel export' },
        ].map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="tap flex min-h-12 items-center justify-center rounded-xl border border-rule-strong bg-surface px-3 text-center text-sm font-medium text-ink transition-colors duration-press ease-ledger active:bg-surface-2"
          >
            {link.label}
          </Link>
        ))}
      </nav>

      <p className="text-xs leading-relaxed text-muted">
        Counters read live from the database on every visit. A zero means nothing has
        been recorded yet — a failed read shows a message, never a silent zero.
      </p>
    </div>
  )
}
