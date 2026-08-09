import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { requireStaff, resolveEventByCode } from '@/lib/supabase/queries'

export const metadata: Metadata = {
  title: 'Next family',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
}

/**
 * The auto-advance target: after logging an outcome, the form navigates
 * here and this page sends the caller to the next family still needing a
 * call. The sort is the same one the queue screen applies — never called
 * first, then fewest attempts, then oldest attempt.
 */
export default async function RsvpNextPage({ params }: PageProps) {
  const { eventCode } = await params

  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  await requireStaff(event.id, event.code)

  const supabase = await createClient()
  const { data: rows } = await supabase
    .from('v_rsvp_queue')
    .select('group_id')
    .eq('event_id', event.id)
    .not('group_id', 'is', null)
    .order('attempt_count', { ascending: true })
    .order('last_attempt_at', { ascending: true })
    .order('priority', { ascending: false })
    .order('head_name', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!rows?.group_id) {
    redirect(`/${eventCode}/rsvp`)
  }

  redirect(`/${eventCode}/rsvp/${rows.group_id}`)
}
