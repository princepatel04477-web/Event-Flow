import Link from 'next/link'

import { CheckCircleIcon, ChevronRightIcon } from '@/components/icons'
import { createClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils'

/**
 * "What is left to set this event up" — on Today, for an admin, until it is
 * done (UI4 Part S, S5 flow 3).
 *
 * Before this, creating an event landed on a dashboard with nothing saying
 * that the guest list, the staff names, the hotels and the team code were
 * still to do, and the four lived in two different shells.
 *
 * EVERY TICK IS DERIVED, never stored — the same reasoning as CLAUDE.md §5.4's
 * counters: a stored "done" flag drifts, a count does not.
 *   guests  — guest_groups rows exist
 *   staff   — staff_members rows exist
 *   hotels  — hotels rows exist
 *   code    — the team code has been revealed at least once (code_reveal_log,
 *             written by the existing reveal action), i.e. someone has it to
 *             hand out
 * `code_reveal_log` is readable by admins only, which is why this renders for
 * admins only — a lead would see that step stuck forever.
 *
 * Four head-only counts in parallel; renders nothing once all four are done.
 */
export async function SetupChecklist({ eventId, eventCode }: { eventId: string; eventCode: string }) {
  const supabase = await createClient()
  const count = (r: { count: number | null }) => (r.count ?? 0) > 0
  const [guests, staff, hotels, code] = await Promise.all([
    supabase.from('guest_groups').select('id', { count: 'exact', head: true }).eq('event_id', eventId).then(count),
    supabase.from('staff_members').select('id', { count: 'exact', head: true }).eq('event_id', eventId).then(count),
    supabase.from('hotels').select('id', { count: 'exact', head: true }).eq('event_id', eventId).then(count),
    supabase.from('code_reveal_log').select('id', { count: 'exact', head: true }).eq('event_id', eventId).then(count),
  ])

  const admin = `/admin/events/${eventCode}`
  const steps = [
    { done: guests, label: 'Import the guest list', href: `/${eventCode}/guests/import` },
    { done: staff, label: 'Add staff names', href: `${admin}/staff` },
    { done: hotels, label: 'Add hotels & rooms', href: `${admin}/hotels` },
    { done: code, label: 'Share the team code', href: `${admin}/codes` },
  ]
  const doneCount = steps.filter((s) => s.done).length
  if (doneCount === steps.length) return null

  return (
    <section aria-labelledby="setup-heading" className="rounded-2xl border border-rule bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="setup-heading" className="font-display text-2xl text-ink">
          Set up this event
        </h2>
        <span className="figure text-sm text-muted">
          {doneCount} of {steps.length}
        </span>
      </div>
      <ol className="mt-3 flex flex-col">
        {steps.map((s) => (
          <li key={s.label} className="border-t border-rule first:border-t-0">
            <Link
              href={s.href}
              className="tap flex min-h-13 items-center gap-3 py-2 transition-colors duration-press ease-ledger active:bg-surface-2"
            >
              <span
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                  s.done ? 'bg-green-tint text-ledger-green' : 'border border-rule-strong',
                )}
              >
                {s.done ? <CheckCircleIcon className="h-5 w-5" aria-label="Done" /> : null}
              </span>
              <span className={cn('min-w-0 flex-1 text-base', s.done ? 'text-muted line-through' : 'font-medium text-ink')}>
                {s.label}
              </span>
              {!s.done ? <ChevronRightIcon className="h-5 w-5 shrink-0 text-subtle" aria-hidden /> : null}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  )
}

export default SetupChecklist
