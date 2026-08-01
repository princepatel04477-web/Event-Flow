import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'

import { Card, CardBody } from '@/components/ui/Card'
import { LinkButton } from '@/components/ui/LinkButton'
import { createClient } from '@/lib/supabase/server'
import { requireStaff, resolveEventByCode } from '@/lib/supabase/queries'

export const metadata: Metadata = {
  title: 'Review call',
}

type PageProps = {
  params: Promise<{ eventCode: string; groupId: string }>
}

/**
 * The caller's entry point into review: "I just finished a call with this
 * family, show me what the AI made of it."
 *
 * A group can accumulate several extractions — one per call — so this
 * resolves which one is actually waiting and hands over to the canonical
 * `/review/[extractionId]` screen. Keying the URL by group is right for the
 * caller (they think in families, and they arrive here from the call screen);
 * keying the review screen itself by extraction is right for the data (an
 * extraction is the thing being approved, and two calls to one family are two
 * separate decisions).
 */
export default async function GroupReviewPage({ params }: PageProps) {
  const { eventCode, groupId } = await params

  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  await requireStaff(event.id, event.code)

  const supabase = await createClient()

  const { data: group } = await supabase
    .from('guest_groups')
    .select('id, head_name')
    .eq('id', groupId)
    .eq('event_id', event.id)
    .maybeSingle()

  if (!group) notFound()

  // Newest first. A pending extraction wins over an already-decided one even
  // if the decided one is more recent — the pending row is the outstanding
  // piece of work, and that is what the caller came here to clear.
  const { data: extractions } = await supabase
    .from('rsvp_extractions')
    .select('id, status, created_at')
    .eq('group_id', groupId)
    .eq('event_id', event.id)
    .order('created_at', { ascending: false })

  const pending = (extractions ?? []).find((e) => e.status === 'pending')
  const target = pending ?? (extractions ?? [])[0]

  if (target) redirect(`/${event.code}/review/${target.id}`)

  // Nothing to review — either the recording has not come back from the
  // extraction pipeline yet, or the call was logged without one.
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardBody className="flex flex-col gap-3">
          <div>
            <h1 className="text-lg font-semibold text-fg">Nothing to review yet</h1>
            <p className="mt-1 text-sm text-muted">
              No AI extraction has arrived for {group.head_name}. If the call was just made, the
              recording may still be uploading or being transcribed — check back shortly.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <LinkButton href={`/${event.code}/call/${groupId}/manual`} size="lg" fullWidth>
              Enter the RSVP manually
            </LinkButton>
            <Link
              href={`/${event.code}/queue`}
              className="tap rounded-xl px-3 py-2 text-center text-sm font-medium text-muted hover:bg-surface-2 hover:text-fg"
            >
              Back to the queue
            </Link>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
