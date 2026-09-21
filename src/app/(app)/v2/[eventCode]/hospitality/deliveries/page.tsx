import type { Metadata } from 'next'

import { requireHamperScreen } from './_guard'
import { HamperRun } from './HamperRun'

export const metadata: Metadata = {
  title: 'Deliver a hamper',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
}

/**
 * Job 3 of the v2 rebuild: deliver a hamper — the list of families still owed
 * something, each one tap from the camera.
 *
 * The guard is `requireHamperScreen` (see `_guard.ts`): staff, and either the
 * hospitality or the hamper department. It is run here rather than inherited,
 * because the v1 section layouts that enforce it are in the other route group
 * and inject nothing into `(app)/v2/`.
 */
export default async function HampersPage({ params }: PageProps) {
  const { eventCode } = await params
  const { event, canGenerate, canOpenGuestList } = await requireHamperScreen(eventCode)

  return (
    <HamperRun
      eventId={event.id}
      eventCode={event.code}
      canGenerate={canGenerate}
      canOpenGuestList={canOpenGuestList}
    />
  )
}
