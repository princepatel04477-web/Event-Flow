import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { requireAdmin, resolveEventByCode } from '@/lib/supabase/queries'

import { ImportWizard } from './_components/ImportWizard'

export const metadata: Metadata = {
  title: 'Import guests',
}

type PageProps = {
  // Next 15+ hands params over as a Promise.
  params: Promise<{ eventCode: string }>
}

export default async function ImportPage({ params }: PageProps) {
  const { eventCode } = await params

  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  // Import is admin-only. Two separate reasons, worth keeping apart:
  //
  // 1. Honesty. The (staff) layout only proves membership, and
  //    `app.is_member()` is true for a client-role account. Left alone, a
  //    client would get an import wizard whose preview calls every family
  //    "New" — because RLS hands them zero existing rows with no error. A
  //    fabricated preview is worse than a locked door.
  // 2. Product. RLS would in fact let an `event_team` member insert
  //    import_batches, import_rows and guest_groups; the human decided one
  //    admin owns the file that turns an empty database into 238 families.
  //    That is a restriction layered above the database, not a security
  //    boundary — RLS remains the fence. To relax it, swap this one call for
  //    `requireStaff` and add the Import tab back in BottomTabs. No migration.
  await requireAdmin(event.id, event.code, 'import')

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold text-fg">Excel import</h2>
        <p className="mt-0.5 text-sm text-muted">
          Upload the calling list, map its columns, review the preview, then confirm. Nothing
          writes to the database until you approve it.
        </p>
      </div>

      <ImportWizard eventId={event.id} eventCode={event.code} />
    </div>
  )
}
