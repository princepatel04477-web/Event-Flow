import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { EmptyState } from '@/components/ui/EmptyState'
import { ClipboardCheckIcon } from '@/components/icons'
import { requireSection } from '@/lib/auth/section-guard'
import { resolveEventByCode } from '@/lib/supabase/queries'

export const metadata: Metadata = {
  title: 'Production',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
}

export default async function ProductionPage({ params }: PageProps) {
  const { eventCode } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  await requireSection(event.id, event.code, 'production')

  return (
    <EmptyState
      icon={<ClipboardCheckIcon className="h-7 w-7" />}
      title="Production prep"
      description="Your team’s setup checklist and run-of-show tools will live here. For now, use Home for event-day numbers."
    />
  )
}
