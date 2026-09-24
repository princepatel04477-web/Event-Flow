import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import { ReadFailure } from '@/components/ui/ReadFailure'
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
 *
 * ── THE ERROR IS CHECKED NOW (M11) ─────────────────────────────────────────
 * This read destructured `{ data: rows }` and dropped `error`, so a failed
 * request produced `null` and fell into the redirect below. `/rsvp/status` then
 * rendered "Nothing waiting to call — Every family has been called, or the list
 * is empty." A caller on bad Wi-Fi who saved one outcome and then had the next
 * read fail was told the 238-family list was finished, and stopped working.
 *
 * The fix is NOT to redirect somewhere carrying a flag. It is to claim nothing:
 * on a failed read the caller stays here and is told the read failed, with a
 * Retry. An empty list and an unreadable list are different facts, and merging
 * them IS the bug.
 */
export default async function RsvpNextPage({ params }: PageProps) {
  const { eventCode } = await params

  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  await requireStaff(event.id, event.code)

  const supabase = await createClient()
  const { data: rows, error } = await supabase
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

  if (error) {
    return <ReadFailure what="the next family to call" />
  }

  if (!rows?.group_id) {
    redirect(`/${eventCode}/rsvp/status`)
  }

  redirect(`/${eventCode}/rsvp/status/${rows.group_id}`)
}
