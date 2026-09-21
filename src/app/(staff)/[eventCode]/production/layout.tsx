import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'

import { requireSection } from '@/lib/auth/section-guard'
import { resolveEventByCode } from '@/lib/supabase/queries'

type Props = {
  children: ReactNode
  params: Promise<{ eventCode: string }>
}

export default async function ProductionSectionLayout({ children, params }: Props) {
  const { eventCode } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()
  await requireSection(event.id, event.code, 'production')
  return children
}
