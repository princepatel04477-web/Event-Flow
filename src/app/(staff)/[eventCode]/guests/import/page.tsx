import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { readImportContext } from '@/lib/actions/import'
import { requireStaff, resolveEventByCode } from '@/lib/supabase/queries'

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

  // NOT admin-only any more, and the nav no longer claims it is.
  //
  // It WAS `requireAdmin(..., 'import')` while `SECTIONS.guests` advertised the
  // Import child to `event_team` — so the tab rendered for a management lead on
  // a code session and the page bounced them to Today with "Importing the guest
  // list is an admin job". A tab that can only bounce is worse than no tab
  // (`docs/BUGS.md` M5).
  //
  // The two things that make this safe are unchanged, and neither was ever the
  // role gate:
  //
  // 1. The section layout above already runs `requireSection(..., 'guests')`, so
  //    only management and admins reach this page at all — a client and every
  //    other department are turned away one level up.
  // 2. The screenshot review before the write is the protection (CLAUDE.md §5.6,
  //    §15's "never cut: import preview"), not the role. `commitImport` has
  //    always accepted `event_team`; RLS remains the fence.
  await requireStaff(event.id, event.code)

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
