import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query'

import { ChevronRightIcon, ShieldAlertIcon, UsersIcon } from '@/components/icons'
import { EmptyState } from '@/components/ui/EmptyState'
import { LinkButton } from '@/components/ui/LinkButton'
import { NowCard } from '@/components/ui/NowCard'
import { Progress } from '@/components/ui/Progress'
import { Row } from '@/components/ui/Row'
import { readBoard } from '@/lib/actions/dashboard'
import { getStaffViewerContext } from '@/lib/auth/section-guard'
import { v2DepartmentHome } from '@/lib/departments'
import { queryKeys } from '@/lib/query/keys'
import { requireStaff, resolveEventByCode, type DeniedReason } from '@/lib/supabase/queries'
import { traceFetch } from '@/lib/perf'

import {
  attentionJobs,
  attentionRows,
  departmentJob,
  moreNumbers,
  nowJob,
  progressBars,
  type StaffFocus,
  type TodayNumbers,
} from './_home/today'
import { readVisibleNumbers } from './_home/visibleNumbers'

export const metadata: Metadata = {
  title: 'Today',
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

/**
 * Today — the home screen, rebuilt to SPEC-V3 §4.
 *
 * ONE JOB: "what do I do next, and are we winning". Everything else this
 * screen used to carry (three stacked job cards, three number tiles, a
 * guests-expected card with its own legend, a welcome banner, the event name
 * as a second title under the shell's) is deleted. What is left is the §4
 * order and nothing else:
 *
 *     Now card  →  one card of ≤3 Progress bars  →  "Needs attention" ≤3 Rows
 *               →  admin extras behind a disclosure  →  one small Help link
 *
 * ── No header here, on purpose ─────────────────────────────────────────────
 * The shell already renders `AppHeader`, and `v3ScreenTitle('')` names this
 * route "Today" with the event's dates as its context line. §4's
 * "ScreenHeader(event name, date · Hi <name>)" is therefore served by the
 * shell for the title and the dates; the greeting would need a read of
 * `staff_members` only to print a first name, and §3's rule is that words
 * which do not change what you do are the first thing to delete. Two headers
 * on one screen is the one thing this screen must not do.
 *
 * ── What the EXTRA fixed, and how ──────────────────────────────────────────
 * `readBoard()` answers `null` for a permissions answer, a transport error and
 * a genuinely absent row alike (see `_home/visibleNumbers.ts` for the three
 * cases verbatim), and this page used to render that `null` as a full-screen
 * "Could not load the numbers". On a staff session that reads nothing from the
 * invoker-rights board view while still passing the claims-based page gate,
 * that is a wall where the app should be a screen.
 *
 * Now: the board is tried first (it is one round trip and it is cached for
 * 30s), and if it does not answer, `readVisibleNumbers` counts what this
 * session demonstrably CAN read — families, guests, beds, hampers — from the
 * base tables. `numbersDegraded` records which of the two answered, so the
 * screen can stop claiming a zero count means "an empty event", which is the
 * one thing a fallback must never do.
 */
export default async function AppHomePage({ params, searchParams }: PageProps) {
  const { eventCode } = await params
  const { denied } = await searchParams
  const deniedNote = deniedMessage(denied)

  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  const [access, viewerCtx] = await Promise.all([
    requireStaff(event.id, event.code),
    getStaffViewerContext(event.id),
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

  // THE DEGRADED PATH. Only paid for when the board did not answer, so the
  // normal render is unchanged.
  const fallback = board ? null : await readVisibleNumbers(event.id)
  const numbers: TodayNumbers | null = board ?? fallback
  const degraded = board === null && fallback !== null

  // The viewer this page is for. `staff_members.department` for a code
  // session; an admin has no department and gets the whole board, which is
  // what `getStaffViewerContext` already answers as 'management'.
  const focus: StaffFocus = viewerCtx?.department ?? 'management'

  // Zero-guests empty state (UX-RULES R3) — but ONLY when the board itself
  // answered. A fallback that counted nothing is a permissions answer, not an
  // empty event, and saying "no guests on this event yet" there would be a
  // confident lie on a wedding with 238 families.
  if (board && board.totalGroups === 0) {
    return (
      <div className="flex flex-col gap-4">
        <DeniedNote note={deniedNote} />

        <EmptyState
          icon={<UsersIcon className="h-7 w-7" />}
          title="No guests on this event yet"
          description="This screen fills in as soon as there is a guest list to count. Import the calling sheet and every number here starts working."
        />

        <nav aria-label="Get started" className="grid grid-cols-1 gap-2.5">
          {access === 'admin' ? (
            <LinkButton href={`/${event.code}/guests/import`} size="lg" fullWidth>
              Import the guest list
            </LinkButton>
          ) : (
            <p className="rounded-xl border border-rule-strong bg-surface px-3.5 py-3 text-sm leading-snug text-muted">
              Importing the guest list is an admin job. Ask your event admin to run the
              import — this screen fills in by itself once they have.
            </p>
          )}
          <LinkButton href={`/${event.code}/guests`} variant="secondary" fullWidth>
            Go to the guest list
          </LinkButton>
        </nav>
      </div>
    )
  }

  // Nothing answered, not even the base tables. Still not a wall: the Now card
  // falls back to the department's own next action and says, in one line, that
  // the counters are unavailable. No reload instruction — §11b of CLAUDE.md is
  // explicit that reloading is the action that makes a bad connection worse.
  if (!numbers) {
    const job = departmentJob(focus, event.code)
    return (
      <div className="flex flex-col gap-5">
        <DeniedNote note={deniedNote} />
        <NowCard
          eyebrow="Right now"
          headline={job.headline}
          context={job.context}
          actionLabel={job.actionLabel}
          actionHref={job.href}
        />
        <p className="text-sm leading-snug text-muted">
          The counters are not loading on this phone right now. Every screen still works.
        </p>
        <HelpLink eventCode={event.code} />
      </div>
    )
  }

  const jobs = attentionJobs(numbers, event.code)
  const now = nowJob(jobs, focus, event.code)
  const rest = attentionRows(jobs, now)
  const bars = progressBars(numbers, focus)

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <div className="flex flex-col gap-5">
        <DeniedNote note={deniedNote} />

        <NowCard
          eyebrow="Right now"
          headline={now.headline}
          context={now.context}
          actionLabel={now.actionLabel}
          actionHref={now.href}
        />

        {bars.length > 0 ? (
          <section
            aria-label="How it is going"
            className="flex flex-col gap-4 rounded-2xl border border-rule-strong bg-surface p-4 shadow-e1"
          >
            {bars.map((bar) => (
              <Progress
                key={bar.label}
                label={bar.label}
                done={bar.done}
                total={bar.total}
                tone={bar.tone}
              />
            ))}
          </section>
        ) : null}

        {rest.length > 0 ? (
          <section aria-labelledby="attention-heading" className="flex flex-col gap-2">
            <h2 id="attention-heading" className="eyebrow text-muted px-1">
              Needs attention
            </h2>
            {/* A Row with no `onPress` renders a div, so wrapping it in a Link
                is valid HTML and the WHOLE row stays the tap target. */}
            <div className="overflow-hidden rounded-2xl border border-rule-strong bg-surface">
              {rest.map((job) => (
                <Link key={job.id} href={job.href} className="tap block">
                  <Row
                    heading={job.headline}
                    meta={job.context}
                    status={job.status}
                    tone="waiting"
                    trailing={<ChevronRightIcon className="h-5 w-5" />}
                  />
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {/* §4: admin-only extra counters go BELOW a "More numbers" disclosure.
            Native <details> — no script, works before hydration, and it is the
            one control on this screen that is allowed to be quiet. */}
        {access === 'admin' ? (
          <details className="rounded-2xl border border-rule-strong bg-surface">
            <summary className="tap flex min-h-12 cursor-pointer items-center px-4 text-base font-medium text-ink">
              More numbers
            </summary>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-rule px-4 py-3.5">
              {moreNumbers(numbers).map((row) => (
                <div key={row.label} className="min-w-0">
                  <dt className="text-sm leading-snug text-muted">{row.label}</dt>
                  <dd className="figure mt-0.5 text-lg leading-none font-medium text-ink">
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        ) : null}

        {degraded ? (
          <p className="text-xs leading-relaxed text-subtle">
            Some counters could not be read on this phone, so they are left out rather
            than shown as zero.
          </p>
        ) : null}

        <HelpLink eventCode={event.code} />
      </div>
    </HydrationBoundary>
  )
}

/**
 * §3: "Help = inside Today (small link), not in the header."
 *
 * Not role-gated: this page already ran `requireStaff`, so every viewer who can
 * see it is staff, and the help route runs the same guard.
 */
function HelpLink({ eventCode }: { eventCode: string }) {
  return (
    <Link
      href={`/${eventCode}/help`}
      className="tap -mt-1 self-start py-2 text-sm font-medium text-muted underline underline-offset-4 hover:text-ink"
    >
      How this app works
    </Link>
  )
}
