import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { resolveEventByCode } from '@/lib/supabase/queries'
import { StaffClient, type StaffRow } from './StaffClient'

export const metadata: Metadata = { title: 'Staff' }

type PageProps = {
  params: Promise<{ eventCode: string }>
}

/**
 * Staff management for one event.
 *
 * This route was referenced before it existed: /pick-staff offers an admin a
 * "Add staff members" button pointing here, and the admin dashboard warns
 * "add at least one name". Neither had anywhere to go.
 *
 * `staff_members` is `select using (app.is_admin() or app.is_staff(event_id))`
 * and admin-only for writes, so a non-admin reaching this route reads rows but
 * cannot change them — the admin layout guard above is what keeps them out.
 */
export default async function StaffPage({ params }: PageProps) {
  const { eventCode } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('staff_members')
    .select('id, full_name, is_active, created_at')
    // Same ordering as /pick-staff, so the admin sees the list in the order
    // the caller will see it. Active first: a long deactivated tail must not
    // push the people who are actually working below the fold.
    .eq('event_id', event.id)
    .order('is_active', { ascending: false })
    .order('full_name', { ascending: true })

  const rows: StaffRow[] = (data ?? []).map((r) => ({
    id: r.id,
    fullName: r.full_name,
    isActive: r.is_active,
  }))

  return (
    <StaffClient
      eventId={event.id}
      eventCode={event.code}
      eventName={event.name}
      rows={rows}
      loadError={error?.message ?? null}
    />
  )
}
