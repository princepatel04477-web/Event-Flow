import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { readImportContext } from '@/lib/actions/import'
import { requireAdmin, resolveEventByCode } from '@/lib/supabase/queries'

import { ImportPreview } from './_components/ImportPreview'

export const metadata: Metadata = {
  title: 'Import preview',
}

type PageProps = {
  // Next 15+ hands params over as a Promise.
  params: Promise<{ eventCode: string }>
}

/**
 * The import screen lives at /[eventCode]/import and not /admin/import.
 *
 * Not a preference — a requirement of the parser. The sheet writes dates as
 * bare ordinals ("4TH"), and an ordinal is only a date once you know which
 * month and year it falls in. That comes from `events.starts_on`, so the
 * screen needs an event in scope before it can read a single travel date.
 * /admin/import has no event and would have to make the admin pick one first,
 * which is precisely what /[eventCode] already is. Every table in this schema
 * is fenced by `event_id` (CLAUDE.md §5); an import screen with no event is
 * not a screen this schema can support.
 */
export default async function ImportPage({ params }: PageProps) {
  const { eventCode } = await params

  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  // Import is admin-only. Two separate reasons, worth keeping apart:
  //
  // 1. Honesty. The (staff) layout only proves membership, and
  //    `app.is_member()` is true for a client-role account. Left alone, a
  //    client would get an import screen whose "already in this event" counts
  //    read zero — because RLS hands them zero rows with no error. A
  //    fabricated preview is worse than a locked door.
  // 2. Product. RLS would in fact let an `event_team` member run the import;
  //    the human decided one admin owns the file that turns an empty database
  //    into 238 families. That is a restriction layered above the database,
  //    not a security boundary — RLS remains the fence. To relax it, swap this
  //    one call for `requireStaff` and add the Import tab back in BottomTabs.
  //    No migration.
  await requireAdmin(event.id, event.code, 'import')

  const context = await readImportContext(event.id)

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold text-fg">Excel import</h2>
        <p className="mt-0.5 text-sm text-muted">
          Read the calling list, review what the parser made of it, then confirm to write the
          families to this event.
        </p>
      </div>

      <ImportPreview
        eventId={event.id}
        eventStartsOn={event.starts_on}
        eventEndsOn={event.ends_on}
        context={context}
      />
    </div>
  )
}
