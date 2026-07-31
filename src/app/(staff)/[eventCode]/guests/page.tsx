import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ShieldAlertIcon, UsersIcon } from '@/components/icons'
import { EmptyState } from '@/components/ui/EmptyState'
import { createClient } from '@/lib/supabase/server'
import { resolveEventByCode } from '@/lib/supabase/queries'

import { FamilySection } from './_components/FamilySection'
import { groupByFamilyHead, type GuestRow } from './_components/format'

export const metadata: Metadata = {
  title: 'Guest list',
}

type PageProps = {
  // Next 15+ hands params over as a Promise.
  params: Promise<{ eventCode: string }>
}

/**
 * The client home screen — and the only screen a `client` login can use.
 *
 * It lives in the `(staff)` route group despite serving clients. A Next.js
 * route group is URL-invisible, so two groups cannot both own `/[eventCode]`;
 * putting this anywhere else would collide with the dashboard. The group name
 * is now a misnomer. Renaming it would touch every route in the app, so it
 * stays.
 *
 * Not gated: staff and admins may open this too (CLAUDE.md §7 — an admin may
 * enter any group), and it is genuinely useful as the "what does the client
 * see?" view.
 *
 * READS ONLY `client_guest_profiles`, and never joins it. That view is
 * `security_invoker = false`: it runs as its owner, bypasses base-table RLS,
 * and is fenced solely by its own `where app.is_member(event_id)`. Join it
 * against any base table and PostgREST reintroduces that table's RLS, which
 * for a client is zero rows — the result silently empties out.
 */
export default async function GuestsPage({ params }: PageProps) {
  const { eventCode } = await params

  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('client_guest_profiles')
    .select('*')
    .eq('event_id', event.id)
    .order('family_head', { ascending: true, nullsFirst: false })
    .order('guest_name', { ascending: true, nullsFirst: false })

  // An empty read and a failed read look identical if you only check `data`.
  // Say which one happened rather than presenting a query error as "no guests".
  if (error) {
    return (
      <EmptyState
        icon={<ShieldAlertIcon className="h-7 w-7" />}
        title="Could not load the guest list"
        description="The guest list did not come back from the database this time. This is a load failure, not an empty list — pull down to refresh, and tell your event team if it keeps happening."
      />
    )
  }

  const rows: GuestRow[] = data ?? []

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<UsersIcon className="h-7 w-7" />}
        title="No guest details yet"
        description="Nothing has been shared on this event yet. Usually that means the guest list has not been imported, or your account is on the event but no guests are linked to it. Ask your event team — nothing has gone wrong."
      />
    )
  }

  const families = groupByFamilyHead(rows)

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold text-fg">Guest list</h2>
        <p className="mt-0.5 text-sm text-muted">
          {rows.length} {rows.length === 1 ? 'guest' : 'guests'} · {families.length}{' '}
          {families.length === 1 ? 'family' : 'families'}. Read-only — your event team
          keeps this up to date.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {families.map((family, index) => (
          <FamilySection key={family.key} family={family} index={index} />
        ))}
      </div>

      <p className="text-xs leading-relaxed text-subtle">
        Travel times and room numbers appear here as soon as the event team records them.
        A blank line means &quot;not shared yet&quot;, not &quot;nothing planned&quot;.
      </p>
    </div>
  )
}
