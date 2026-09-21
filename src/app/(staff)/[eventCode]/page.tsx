import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { AttentionPanel } from '@/components/dashboard/AttentionPanel'
import { StatCard } from '@/components/dashboard/StatCard'
import { ShieldAlertIcon, UsersIcon } from '@/components/icons'
import { EmptyState } from '@/components/ui/EmptyState'
import { readBoard } from '@/lib/actions/dashboard'
import { getStaffViewerContext } from '@/lib/auth/section-guard'
import { departmentHomePath } from '@/lib/departments'
import {
  requireStaff,
  resolveEventByCode,
  type DeniedReason,
} from '@/lib/supabase/queries'
import { traceFetch } from '@/lib/perf'
import { count, formatCount } from '@/lib/utils'

export const metadata: Metadata = {
  title: 'Home',
}

/**
 * Messages for `?denied=`, looked up rather than read out of the URL.
 *
 * `requireAdmin` bounces an event_team member here, and a bounce with no
 * explanation reads as a broken link. The query string only ever selects a
 * key — the sentence itself is ours, so a crafted URL cannot put words in
 * the app's mouth.
 */
const DENIED_MESSAGES: Record<DeniedReason | 'section', string> = {
  import:
    'Importing the guest list is an admin job, so we brought you back here. Ask your event admin to run the import.',
  admin: 'That screen is admin-only, so we brought you back here.',
  section: 'That screen is for another team. Use the tabs at the bottom for your department.',
}

function deniedMessage(value: string | undefined): string | null {
  if (!value) return null
  return DENIED_MESSAGES[value as DeniedReason | 'section'] ?? null
}

/** The `?denied=` note, rendered above whatever the page shows next. */
function DeniedNote({ note }: { note: string | null }) {
  if (!note) return null
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-rule-strong bg-surface px-3.5 py-3">
      <ShieldAlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-muted" />
      <p className="text-sm leading-snug text-ink">{note}</p>
    </div>
  )
}

type PageProps = {
  // Next 15+ hands params and searchParams over as Promises.
  params: Promise<{ eventCode: string }>
  searchParams: Promise<{ denied?: string }>
}

export default async function EventHomePage({ params, searchParams }: PageProps) {
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
  // client would be told "0 families" for a 238-family wedding.
  const access = await requireStaff(event.id, event.code)
  const viewerCtx = await getStaffViewerContext(event.id)
  if (access === 'event_team' && viewerCtx?.department) {
    redirect(departmentHomePath(event.code, viewerCtx.department))
  }

  // The read goes through the 30s TTL cache in dashboard.ts, and the
  // request-scoped Supabase client is shared, so a revisit renders from
  // memory instead of paying a ~150ms round-trip to the Supabase region.
  // ONE read, both panels. These used to be two reads of two views in
  // Promise.all — parallel, but still two round trips to Seoul for data that
  // now comes back as a single row (v_event_board).
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
      <div className="flex flex-col gap-4">
        <DeniedNote note={deniedNote} />
        <EmptyState
          icon={<ShieldAlertIcon className="h-7 w-7" />}
          title="Could not load the numbers"
          description="The counters did not come back from the database this time. This is a load failure, not an empty event — reload the page, and tell your admin if it keeps happening."
        />
      </div>
    )
  }

  const totalGroups = count(stats.totalGroups)
  const totalGuests = count(stats.totalPax)
  const confirmed = count(stats.rsvpConfirmed)
  const pending = count(stats.rsvpPending)

  // An event with no guest list renders a grid of zeros that reads as a broken
  // page rather than an empty one. It is not broken — `v_event_board` selects
  // FROM events with scalar subqueries, so every event gets a row and an event
  // with no data gets a row of zeros. But "0 / 0 / 0 / 0 / 0 / 0" above a
  // paragraph explaining that zero means nothing recorded yet is the app
  // explaining in body copy what the screen should be saying outright, and it
  // has already been read as "new events do not get a dashboard".
  //
  // Gate on totalGroups, not on the whole board: once one family exists the
  // counters are meaningful even while every other number is still zero. Zero
  // families is the only state where there is genuinely nothing to count.
  //
  // Ported here from the `dashboard/` copy of this screen, which was the only
  // one that had it. `docs/UX-RULES.md` cites this empty state as the model
  // for R3 while pointing at that copy — so the rule's own example lived on a
  // route the tab bar never sent anyone to, and a real new event got the grid
  // of zeros instead.
  if (totalGroups === 0) {
    return (
      <div className="flex flex-col gap-4">
        <DeniedNote note={deniedNote} />

        <EmptyState
          icon={<UsersIcon className="h-7 w-7" />}
          title="No guests on this event yet"
          description="This screen fills in as soon as there is a guest list to count. Import the calling sheet and every number here starts working — families, RSVPs, rooms, arrivals and hampers."
        />

        {/*
          The import CTA is admin-only because the import PAGE is: it calls
          `requireAdmin(..., 'import')`, which bounces an event_team member
          straight back here with `?denied=import`. Offering the button to
          everyone would send a team member round a loop — tap, bounce, land
          back on the same empty board — and the denial note would read as a
          bug rather than a rule. Staff get the honest version instead: who to
          ask.
        */}
        <nav aria-label="Get started" className="grid grid-cols-1 gap-2.5">
          {access === 'admin' ? (
            <Link
              href={`/${event.code}/guests/import`}
              className="tap flex min-h-12 items-center justify-center rounded-xl border border-transparent bg-brand px-3 text-center text-base font-semibold text-brand-fg transition-colors duration-press ease-ledger"
            >
              Import the guest list
            </Link>
          ) : (
            <p className="rounded-xl border border-rule-strong bg-surface px-3.5 py-3 text-sm leading-snug text-muted">
              Importing the guest list is an admin job. Ask your event admin to
              run the import — this screen fills in by itself once they have.
            </p>
          )}
          <Link
            href={`/${event.code}/guests/list`}
            className="tap flex min-h-12 items-center justify-center rounded-xl border border-rule-strong bg-surface px-3 text-center text-sm font-medium text-ink transition-colors duration-press ease-ledger active:bg-surface-2"
          >
            Go to the guest list
          </Link>
        </nav>
      </div>
    )
  }

  // The split bar under the headline figure. Percentages of FAMILIES, because
  // that is what confirmed/pending count — mixing a guest numerator with a
  // family denominator is the classic way a dashboard lies.
  const confirmedPct = totalGroups > 0 ? (confirmed / totalGroups) * 100 : 0
  const pendingPct = totalGroups > 0 ? (pending / totalGroups) * 100 : 0

  return (
    <div className="flex flex-col gap-4">
      <DeniedNote note={deniedNote} />

      {/* First, not fourth. This panel is the only thing on the screen that is
          about RIGHT NOW, and it renders nothing when there is nothing wrong —
          so on a calm day the screen still opens on its headline. It used to
          sit below six counters, which put the one block worth acting on
          behind a scroll. */}
      <AttentionPanel attn={attn} eventCode={event.code} />

      {/* The headline. One figure, the size of a thumb, and the split that
          explains it — this is the number someone shouts across a room. */}
      <section className="list-fade rounded-2xl border border-brand/25 bg-surface bg-[linear-gradient(158deg,var(--ef-brand-tint),transparent_62%)] p-4 shadow-[0_16px_40px_-22px_rgba(0,0,0,0.85)]">
        <h2 className="eyebrow text-brand">Guests expected</h2>

        <div className="mt-2 flex items-end gap-3">
          <span className="figure text-6xl leading-none font-medium tracking-tight text-ink">
            {formatCount(totalGuests)}
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
          aria-label={`${formatCount(confirmed)} of ${formatCount(totalGroups)} families confirmed, ${formatCount(pending)} still to call`}
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
            {formatCount(pending)} still to call
          </span>
        </div>
      </section>

      {/* Every counter is a question, and the answer is on another screen — so
          every tile is the link to that screen (R4). These point at the section
          routes; they used to point at the flat copies, which were the OLDER
          fork of the same screen. */}
      <div className="grid grid-cols-2 gap-2.5">
        <StatCard
          label="Families confirmed"
          value={confirmed}
          tone="success"
          note={totalGroups > 0 ? `of ${formatCount(totalGroups)} families` : undefined}
          href={`/${event.code}/rsvp/queue`}
          style={{ animationDelay: '0ms' }}
        />
        <StatCard
          label="Still to call"
          value={pending}
          tone="warning"
          note="not started, tried, call back, or unsure"
          href={`/${event.code}/rsvp/queue`}
          style={{ animationDelay: '40ms' }}
        />
        <StatCard
          label="Guests with a room"
          value={stats.guestsRoomed}
          note="have a room right now"
          href={`/${event.code}/hospitality/rooms`}
          style={{ animationDelay: '80ms' }}
        />
        <StatCard
          label="Arriving today"
          value={stats.arrivalsToday}
          note="travelling in today"
          href={`/${event.code}/logistics/arrivals`}
          style={{ animationDelay: '120ms' }}
        />
        <StatCard
          label="Hampers done"
          value={stats.hampersDelivered}
          tone="success"
          note="photo proof on file"
          href={`/${event.code}/hospitality/deliveries`}
          style={{ animationDelay: '160ms' }}
        />
        <StatCard
          label="Hampers left"
          value={stats.hampersPending}
          tone="info"
          note="no photo yet"
          href={`/${event.code}/hospitality/deliveries`}
          style={{ animationDelay: '200ms' }}
        />
      </div>

      {/* Event-day screens that do not earn a tab slot but do get used all day
          once the guests are actually in the building. */}
      <nav aria-label="Event day" className="grid grid-cols-2 gap-2.5">
        {[
          { href: `/${event.code}/hospitality/checkin`, label: 'Check in / out' },
          { href: `/${event.code}/logistics/departures`, label: 'Departures' },
          { href: `/${event.code}/rsvp/status`, label: 'Log an RSVP' },
          { href: `/${event.code}/guests/export`, label: 'Excel export' },
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
        These numbers are read fresh from the database every time you open this
        screen. A zero means nothing has been recorded yet — if a number fails to
        load you get a message, never a silent zero.
      </p>
    </div>
  )
}
