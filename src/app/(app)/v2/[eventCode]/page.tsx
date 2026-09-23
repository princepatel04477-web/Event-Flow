import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query'

import { ShieldAlertIcon, UsersIcon } from '@/components/icons'
import { EmptyState } from '@/components/ui/EmptyState'
import { LinkButton } from '@/components/ui/LinkButton'
import { StaffWelcomeBanner } from '@/components/nav/StaffWelcomeBanner'
import { readBoard } from '@/lib/actions/dashboard'
import { getStaffViewerContext } from '@/lib/auth/section-guard'
import { getSessionClaims } from '@/lib/auth/server'
import { v2DepartmentHome } from '@/lib/departments'
import { queryKeys } from '@/lib/query/keys'
import {
  requireStaff,
  resolveEventByCode,
  type DeniedReason,
} from '@/lib/supabase/queries'
import { traceFetch } from '@/lib/perf'
import { count, formatCount, formatDateRange } from '@/lib/utils'

export const metadata: Metadata = {
  title: 'Home',
}

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
  params: Promise<{ eventCode: string }>
  searchParams: Promise<{ denied?: string }>
}

interface JobItem {
  id: string
  count: number
  description: string
  actionLabel: string
  href: string
}

export default async function AppHomePage({ params, searchParams }: PageProps) {
  const { eventCode } = await params
  const { denied } = await searchParams
  const deniedNote = deniedMessage(denied)

  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  const [access, viewerCtx, codeClaims] = await Promise.all([
    requireStaff(event.id, event.code),
    getStaffViewerContext(event.id),
    getSessionClaims(),
  ])

  if (access === 'event_team' && viewerCtx?.department) {
    const dest = v2DepartmentHome(event.code, viewerCtx.department)
    if (dest) redirect(dest)
  }

  // Pre-warm the TanStack Query cache on the server (V2 fast path).
  const queryClient = new QueryClient()
  const board = await traceFetch('dashboard :: board', () =>
    queryClient.fetchQuery({
      queryKey: queryKeys.dashboard.board(event.id),
      queryFn: () => readBoard(event.id),
    }),
  )

  if (!board) {
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

  const totalGroups = count(board.totalGroups)
  const totalGuests = count(board.totalPax)
  const confirmed = count(board.rsvpConfirmed)
  const pending = count(board.rsvpPending)

  // Zero-guests empty state from the old home, kept exactly as written (UX-RULES R3).
  if (totalGroups === 0) {
    return (
      <div className="flex flex-col gap-4">
        <DeniedNote note={deniedNote} />

        <EmptyState
          icon={<UsersIcon className="h-7 w-7" />}
          title="No guests on this event yet"
          description="This screen fills in as soon as there is a guest list to count. Import the calling sheet and every number here starts working — families, RSVPs, rooms, arrivals and hampers."
        />

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

  // 1. "Right now": up to three job cards, worst first, from non-zero attention numbers.
  const attentionJobs: JobItem[] = [
    {
      id: 'confirmedNoRoom',
      count: board.confirmedNoRoom,
      description: `${formatCount(board.confirmedNoRoom)} confirmed ${
        board.confirmedNoRoom === 1 ? 'guest has' : 'guests have'
      } no room assigned.`,
      actionLabel: 'Assign rooms',
      href: `/${event.code}/hospitality/rooms`,
    },
    {
      id: 'arrivalsNoVehicle',
      count: board.arrivalsNoVehicle,
      description: `${formatCount(board.arrivalsNoVehicle)} ${
        board.arrivalsNoVehicle === 1 ? 'arrival' : 'arrivals'
      } today with no vehicle assigned.`,
      actionLabel: 'Assign vehicles',
      href: `/${event.code}/logistics/fleet`,
    },
    {
      id: 'noDeparture',
      count: board.noDeparture,
      description: `${formatCount(board.noDeparture)} arrived ${
        board.noDeparture === 1 ? 'guest has' : 'guests have'
      } no departure logged.`,
      actionLabel: 'Log departures',
      href: `/${event.code}/logistics/departures`,
    },
    {
      id: 'hampersPending',
      count: board.hampersPending,
      description: `${formatCount(board.hampersPending)} ${
        board.hampersPending === 1 ? 'hamper needs' : 'hampers need'
      } delivery proof.`,
      actionLabel: 'Deliver hampers',
      href: `/${event.code}/hospitality/deliveries`,
    },
  ]

  const activeJobs = attentionJobs
    .filter((j) => j.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)

  // Split percentages for headline guests bar.
  const confirmedPct = totalGroups > 0 ? (confirmed / totalGroups) * 100 : 0
  const pendingPct = totalGroups > 0 ? (pending / totalGroups) * 100 : 0

  const subtitle =
    formatDateRange(event.starts_on, event.ends_on) ?? event.venue_city ?? event.code

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <div className="flex flex-col gap-6">
        <DeniedNote note={deniedNote} />

        {/* Event identity lives on the home screen, not in the sticky header */}
        <header className="flex flex-col gap-1">
          <h1 className="font-display text-2xl leading-tight font-semibold tracking-tight text-ink">
            {event.name}
          </h1>
          {subtitle ? <p className="text-sm text-muted">{subtitle}</p> : null}
        </header>

        {access === 'event_team' ? (
          <StaffWelcomeBanner
            eventCode={event.code}
            department={viewerCtx?.department ?? null}
            staffMemberId={codeClaims?.staffMemberId ?? null}
          />
        ) : null}

        {/* 1. "Right now": up to three job cards, worst first */}
        <section aria-labelledby="right-now-heading" className="flex flex-col gap-3">
          <h2 id="right-now-heading" className="eyebrow text-brand">
            Right now
          </h2>

          {activeJobs.length > 0 ? (
            <div className="flex flex-col gap-3">
              {activeJobs.map((job, index) => (
                <div
                  key={job.id}
                  className="flex flex-col gap-3 rounded-2xl border border-rule-strong bg-surface p-4 shadow-e1"
                >
                  <p className="text-base leading-snug font-medium text-ink">
                    {job.description}
                  </p>
                  {/* One filled primary per screen: the worst job keeps the
                      gold fill, every job below it is an outline. */}
                  <LinkButton
                    href={job.href}
                    size="lg"
                    variant={index === 0 ? 'primary' : 'secondary'}
                    fullWidth
                  >
                    {job.actionLabel}
                  </LinkButton>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-rule-strong bg-surface px-4 py-3.5 text-base text-muted">
              Nothing needs you right now.
            </p>
          )}
        </section>

        {/* 2. "Today": three figures on one row — each linking to its filtered list */}
        <section aria-labelledby="today-heading" className="flex flex-col gap-3">
          <h2 id="today-heading" className="eyebrow text-muted">
            Today
          </h2>

          <div className="grid grid-cols-3 gap-2.5">
            <Link
              href={`/${event.code}/logistics/arrivals`}
              className="tap flex min-h-20 flex-col justify-between rounded-xl border border-rule-strong bg-surface p-3 transition-colors duration-press ease-ledger hover:bg-surface-2 active:bg-surface-2"
            >
              <span className="figure text-3xl font-medium tracking-tight text-ink">
                {formatCount(board.arrivalsToday)}
              </span>
              <span className="mt-1 text-xs leading-tight text-muted">
                Arriving today
              </span>
            </Link>

            <Link
              href={`/${event.code}/logistics/departures`}
              className="tap flex min-h-20 flex-col justify-between rounded-xl border border-rule-strong bg-surface p-3 transition-colors duration-press ease-ledger hover:bg-surface-2 active:bg-surface-2"
            >
              <span className="figure text-3xl font-medium tracking-tight text-ink">
                {formatCount(board.departuresToday)}
              </span>
              <span className="mt-1 text-xs leading-tight text-muted">
                Leaving today
              </span>
            </Link>

            <Link
              href={`/${event.code}/hospitality/deliveries`}
              className="tap flex min-h-20 flex-col justify-between rounded-xl border border-rule-strong bg-surface p-3 transition-colors duration-press ease-ledger hover:bg-surface-2 active:bg-surface-2"
            >
              <span className="figure text-3xl font-medium tracking-tight text-ink">
                {formatCount(board.hampersPending)}
              </span>
              <span className="mt-1 text-xs leading-tight text-muted">
                Hampers left
              </span>
            </Link>
          </div>
        </section>

        <section className="list-fade rounded-2xl border border-brand/25 bg-surface bg-[linear-gradient(158deg,var(--ef-brand-tint),transparent_62%)] p-4 shadow-e2">
          <h2 className="eyebrow text-brand">Guests expected</h2>

          <div className="mt-2 flex items-end gap-3">
            <span className="figure text-6xl leading-none font-medium tracking-tight text-ink">
              {formatCount(totalGuests)}
            </span>
            <span className="pb-2 text-sm leading-snug text-muted">
              guests in {formatCount(totalGroups)} families
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
      </div>
    </HydrationBoundary>
  )
}
