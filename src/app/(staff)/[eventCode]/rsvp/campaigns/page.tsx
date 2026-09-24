import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { CampaignBoard } from '@/components/rsvp/CampaignBoard'
import { ensureCampaigns } from '@/lib/actions/campaigns'
import { createClient } from '@/lib/supabase/server'
import { requireSection } from '@/lib/auth/section-guard'
import { resolveEventByCode } from '@/lib/supabase/queries'

export const metadata: Metadata = {
  title: 'RSVP Campaigns',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
}

export default async function CampaignsPage({ params }: PageProps) {
  const { eventCode } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  await requireSection(event.id, event.code, 'rsvp')

  const supabase = await createClient()
  const [
    { count: guestCount, error: guestError },
    { count: staffCount, error: staffError },
  ] = await Promise.all([
    supabase
      .from('guest_groups')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', event.id),
    supabase
      .from('staff_members')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', event.id)
      .eq('is_active', true),
  ])

  const campaignsResult = await ensureCampaigns(event.id, event.code, event.starts_on)

  // A failed read is NOT an empty event. Both counters are load-bearing — the
  // guest count drives the empty-state sentence and the staff count drives the
  // "add staff names" warning — so a refusal on either one must reach the
  // screen as a load failure, never as `0` and a confident instruction.
  const countsError = guestError ?? staffError
  const loadError = countsError
    ? 'Could not load the calling board. Check your connection and try again.'
    : campaignsResult.ok
      ? null
      : campaignsResult.error

  const campaigns = campaignsResult.ok ? campaignsResult.campaigns : []

  const grokConfigured = Boolean(process.env.XAI_API_KEY)

  return (
    <CampaignBoard
      eventId={event.id}
      eventCode={event.code}
      campaigns={campaigns}
      guestCount={guestCount ?? 0}
      staffCount={staffCount ?? 0}
      loadError={loadError}
      grokConfigured={grokConfigured}
    />
  )
}
