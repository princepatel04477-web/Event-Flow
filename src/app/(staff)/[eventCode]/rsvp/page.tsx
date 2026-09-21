import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import { resolveEventByCode } from '@/lib/supabase/queries'

export const metadata: Metadata = {
  title: 'RSVP',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
}

export default async function RsvpIndexPage({ params }: PageProps) {
  const { eventCode } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()
  redirect(`/${event.code}/rsvp/campaigns`)
}
