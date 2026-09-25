import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { readSectionLocks } from '@/lib/actions/section-locks'
import { isArrivalsNotifyEnabled } from '@/lib/actions/arrivals'
import { resolveEventByCode } from '@/lib/supabase/queries'

import { SectionLockSettings } from './SectionLockSettings'
import { NotificationSettings } from './NotificationSettings'

export const metadata: Metadata = { title: 'Settings' }

type PageProps = { params: Promise<{ eventCode: string }> }

/**
 * The per-event Settings screen (A8).
 *
 * It exists for one control today — lock a section for the field team. The
 * admin event menu had no Settings destination, and the lock toggle needs a
 * home an admin can find without knowing the feature exists.
 */
export default async function AdminEventSettingsPage({ params }: PageProps) {
  const { eventCode } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  const locks = await readSectionLocks(event.id)
  const arrivalsNotify = await isArrivalsNotifyEnabled(event.id)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-xl leading-tight font-semibold tracking-tight text-ink">
          Settings
        </h1>
        <p className="mt-1 text-sm text-muted">
          Lock a section to make it read-only for the field team. Admins keep working.
        </p>
      </div>

      <SectionLockSettings eventId={event.id} initial={locks} />

      <section className="flex flex-col gap-3">
        <h2 className="eyebrow">Notifications</h2>
        <NotificationSettings eventId={event.id} initial={arrivalsNotify} />
      </section>
    </div>
  )
}
