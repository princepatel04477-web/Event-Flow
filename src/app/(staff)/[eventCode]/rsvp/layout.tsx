import type { ReactNode } from 'react'

import { requireSection } from '@/lib/auth/section-guard'
import { resolveEventByCode } from '@/lib/supabase/queries'
import { notFound } from 'next/navigation'

type Props = {
  children: ReactNode
  params: Promise<{ eventCode: string }>
}

export default async function RsvpSectionLayout({ children, params }: Props) {
  const { eventCode } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()
  await requireSection(event.id, event.code, 'rsvp')
  return children
}
