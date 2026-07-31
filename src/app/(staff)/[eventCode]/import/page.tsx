import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { EmptyState } from '@/components/ui/EmptyState'
import { ShieldAlertIcon } from '@/components/icons'
import { getEventAccess, getEventByCode } from '@/lib/supabase/queries'

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

  const event =
    (await getEventByCode(eventCode)) ?? (await getEventByCode(eventCode.toUpperCase()))
  if (!event) notFound()

  // The (staff) layout only checks membership, and `app.is_member()` lets a
  // client-role account reach their event. Without this, a client login sees
  // an import wizard whose preview reports every family as "New", because
  // RLS returns them zero existing rows with no error. Tell them the truth
  // before they can build a fabricated preview. RLS is still the real fence.
  const access = await getEventAccess(event.id)
  if (access !== 'admin' && access !== 'event_team') {
    return (
      <EmptyState
        icon={<ShieldAlertIcon className="h-7 w-7" />}
        title="Import is for event staff"
        description="Your account is on this event as a client, so the guest list is invisible to it — any preview built here would be wrong rather than empty. Ask an admin to add you as event_team if you need to import."
      />
    )
  }

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
