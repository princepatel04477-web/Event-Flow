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
  const [{ count: guestCount }, { count: staffCount }] = await Promise.all([
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

  const campaigns = await ensureCampaigns(event.id, event.code, event.starts_on)

  const grokConfigured = Boolean(process.env.XAI_API_KEY)

  return (
    <CampaignBoard
      eventId={event.id}
      eventCode={event.code}
      campaigns={campaigns}
      guestCount={guestCount ?? 0}
      staffCount={staffCount ?? 0}
      grokConfigured={grokConfigured}
    />
  )
}
