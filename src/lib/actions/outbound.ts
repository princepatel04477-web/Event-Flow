'use server'

import { createClient } from '@/lib/supabase/server'
import { requireStaff } from '@/lib/supabase/queries'

export type OutboundResult =
  | { ok: true; message: string }
  | { ok: false; error: string }

/** Dial the next pending job in a running campaign. */
export async function dialNextCampaignJob(
  campaignId: string,
  eventId: string,
  eventCode: string,
): Promise<OutboundResult> {
  await requireStaff(eventId, eventCode)
  const supabase = await createClient()

  const { data: job } = await supabase
    .from('rsvp_campaign_jobs')
    .select('id')
    .eq('campaign_id', campaignId)
    .eq('event_id', eventId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!job) {
    return { ok: false, error: 'No pending families in this wave.' }
  }

  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/start-outbound-call`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
      ...(process.env.OUTBOUND_WEBHOOK_SECRET
        ? { 'x-webhook-secret': process.env.OUTBOUND_WEBHOOK_SECRET }
        : {}),
    },
    body: JSON.stringify({ job_id: job.id }),
  })

  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    return { ok: false, error: body.error ?? `Dial failed (${res.status})` }
  }

  return {
    ok: true,
    message: body.message ?? body.started ? 'Call started' : 'Job queued',
  }
}
