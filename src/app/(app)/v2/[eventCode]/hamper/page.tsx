import type { Metadata } from 'next'

import { HamperRun } from '../hospitality/deliveries/HamperRun'
import { requireHamperScreen } from '../hospitality/deliveries/_guard'

export const metadata: Metadata = {
  title: 'Hampers',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
}

/**
 * The Hampers tab's landing screen.
 *
 * THIS USED TO BE A STALE v1 RE-EXPORT, and that is the whole reason the file
 * changed. It re-exported `(staff)/[eventCode]/hamper/page.tsx`, whose
 * `DeliveryList` is the v2-era list — chip rows for hotel and kind above the
 * first name, sealed/queued card walls, no Progress and no Now card. So the
 * one tab named for this job led to the oldest screen for it, while the
 * current one (`HamperRun`, under hospitality/deliveries) sat behind the Rooms
 * tab, which a hamper runner cannot even open.
 *
 * `HamperRun` is IMPORTED, not copied, and it is the same screen — the same
 * `readDeliveryRun` read, the same `generateDeliverables` admin action, the
 * same links into `DeliveryDetail`. Two components would drift; this repo has
 * already paid for that lesson twice (see the notes in the v1 hamper pages).
 *
 * `HamperRun` is handed THIS tree's detail path, so every row and the marigold
 * Now-card button open a proof screen whose back link returns to the hamper run
 * rather than to the hospitality list — a hamper runner is deliberately not a
 * member of the `hospitality` section, and the other tree's list would bounce
 * them to `?denied=section` (R3).
 *
 * The guard is the shared `requireHamperScreen`, which admits the union of the
 * hospitality and hamper departments — the same reasoning as the v2 route: a
 * hamper runner is deliberately not a member of `hospitality`, and a
 * `requireSection('hospitality')` here would lock the hamper team out of their
 * own screen.
 */
export default async function HamperPage({ params }: PageProps) {
  const { eventCode } = await params
  const { event, canGenerate, canOpenGuestList } = await requireHamperScreen(eventCode)

  return (
    <HamperRun
      eventId={event.id}
      eventCode={event.code}
      canGenerate={canGenerate}
      canOpenGuestList={canOpenGuestList}
      detailBase="hamper"
    />
  )
}
