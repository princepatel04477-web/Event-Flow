import type { Metadata } from 'next'

import { DeparturesClient } from '@/app/(staff)/[eventCode]/logistics/departures/DeparturesClient'

import { requireTravelScreen } from '../../_guard'

export const metadata: Metadata = {
  title: 'Record a departure',
}

type PageProps = {
  params: Promise<{ eventCode: string }>
}

/**
 * Record a walk-up departure — a family who tells the desk they are leaving.
 *
 * RESTYLED, NOT REDESIGNED (SPEC-V3 §4), and the honest version of that here is
 * "imported, not copied". This screen is a FORM: search a family, fill in a date,
 * a time, a mode, a reference, a drop point and a head count, and save. The v1
 * `DeparturesClient` carries the validation, the cab-expense branch, the
 * existing-leg warning and `saveDeparture` exactly as they must behave, and a
 * second copy is a second place for a validated write to drift.
 *
 * The guard is `requireTravelScreen` rather than the legacy page's own
 * `requireStaff`: this route sits under the Travel layout, which runs the
 * section gate, and the section is who the screen is for. The v1 page it imports
 * does not carry a section gate of its own (it is guarded by the legacy layout),
 * so this is strictly narrower than what the shell alone would allow.
 */
export default async function DeparturesWalkupPage({ params }: PageProps) {
  const { eventCode } = await params
  const { event } = await requireTravelScreen(eventCode)

  return <DeparturesClient eventId={event.id} eventCode={event.code} />
}
