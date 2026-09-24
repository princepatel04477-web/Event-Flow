'use client'

import Link from 'next/link'
import { useState } from 'react'

import { ChevronRightIcon, ShieldAlertIcon } from '@/components/icons'
import { NowCard } from '@/components/ui/NowCard'
import { Progress } from '@/components/ui/Progress'
import { Row } from '@/components/ui/Row'
import { selectTodayNumbers } from '@/lib/store/selectors'
import { useEventStore, useEventStoreMode } from '@/lib/store/useEventStore'

import {
  attentionJobs,
  attentionRows,
  moreNumbers,
  nowJob,
  progressBars,
  type StaffFocus,
  type TodayNumbers,
} from './today'

/**
 * Today's numbers, painted from the store when the store has them.
 *
 * WHY THIS IS A CLIENT COMPONENT AT ALL. Today is the one job screen whose body
 * was rendered entirely on the server, which means every visit to the home tab
 * cost a round trip before a single number appeared. The numbers themselves are
 * fourteen counts over rows the store already holds, so the fix is to derive
 * them locally — but the page must still work on a database without
 * `event_snapshot`, so the server-computed numbers are passed in as the
 * fallback and used whenever the store is not live.
 *
 * `<HydrationBoundary>` IS GONE FROM THIS PATH, deliberately. It existed to hand
 * the client a warm TanStack cache for the board query; with the store live
 * there is no board query to warm, and the store's own IndexedDB hydration is
 * what makes the second visit instant. The dehydrated payload was a few hundred
 * bytes of JSON on every response.
 */
export interface TodayNumbersViewProps {
  /** The server's answer — the board view, or the degraded base-table counts. */
  numbers: TodayNumbers
  eventCode: string
  focus: StaffFocus
  isAdmin: boolean
  deniedNote: string | null
  degraded: boolean
}

export function TodayNumbersView({
  numbers,
  eventCode,
  focus,
  isAdmin,
  deniedNote,
  degraded,
}: TodayNumbersViewProps) {
  const mode = useEventStoreMode()
  const todayKey = useTodayKey()
  const fromStore = useEventStore((state) => selectTodayNumbers(state, todayKey))

  const live = mode === 'store' ? fromStore : numbers
  // The server's "some counters could not be read" note is about ITS read. A
  // store-derived board has all fourteen numbers or none, so the note is only
  // honest on the fallback path.
  const showDegraded = mode === 'store' ? false : degraded

  const jobs = attentionJobs(live, eventCode)
  const now = nowJob(jobs, focus, eventCode)
  const rest = attentionRows(jobs, now)
  const bars = progressBars(live, focus)

  return (
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
      {isAdmin ? (
        <details className="rounded-2xl border border-rule-strong bg-surface">
          <summary className="tap flex min-h-12 cursor-pointer items-center px-4 text-base font-medium text-ink">
            More numbers
          </summary>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-rule px-4 py-3.5">
            {moreNumbers(live).map((row) => (
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

      {showDegraded ? (
        <p className="text-xs leading-relaxed text-subtle">
          Some counters could not be read on this phone, so they are left out rather
          than shown as zero.
        </p>
      ) : null}

      <HelpLink eventCode={eventCode} />
    </div>
  )
}

/**
 * The venue's date, once per mount.
 *
 * `toISOString().slice(0, 10)` would be UTC, which is wrong for the one thing
 * this is used for: "does this leg land today". A leg at 00:30 IST on the 21st
 * is 19:00 UTC on the 20th, and the count would put it on the wrong day every
 * single evening.
 */
function useTodayKey(): string {
  const [key] = useState(() => localDateKey(new Date()))
  return key
}

function localDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
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

/**
 * §3: "Help = inside Today (small link), not in the header."
 *
 * Not role-gated: the page already ran `requireStaff`, so every viewer who can
 * see this is staff, and the help route runs the same guard.
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
