import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'

import { requireAnySection } from '@/lib/auth/section-guard'
import { resolveEventByCode } from '@/lib/supabase/queries'

type Props = {
  children: ReactNode
  params: Promise<{ eventCode: string }>
}

/**
 * The v2 hospitality tree's gate.
 *
 * WHY THIS FILE EXISTS AT ALL. This used to be the one section layout with no
 * v2 counterpart, and the cost was real: a re-export under `(app)/v2` calls the
 * v1 MODULE, so the v1 group's `layout.tsx` never runs and the screen inherits
 * only the shell's `requireStaff`. A travel runner could open
 * `/{event}/hospitality/checkin`, `rooms/new` and `rooms/allocate` and use their
 * controls, while `/{event}/hospitality/rooms` — a hand-built v2 page with its
 * own guard — correctly bounced them (`docs/BUGS.md` M2).
 *
 * WHY THE GUARD IS THE UNION OF TWO SECTIONS. The hamper run's v2 address is
 * under this tree (`hospitality/deliveries`) and its audience is the union of
 * the hamper and hospitality departments, which is what `mayOpenHamperRun`
 * answers. Gating the whole tree with `hospitality` alone would lock the hamper
 * team out of the run that is their entire job — the regression
 * `tests/v2-route-parity.test.ts` warned about when it recorded this layout as a
 * deliberate omission. Gating it with the union keeps every other department
 * out (travel, production and client still get the same `?denied=section`
 * bounce) and lets the two that belong in.
 *
 * The screens that need to be STRICTLY hospitality still are: the Rooms board
 * calls `requireSection(..., 'hospitality')` itself, so a hamper runner who
 * follows this tree's redirect to it is bounced to their own home.
 */
export default async function HospitalitySectionLayout({ children, params }: Props) {
  const { eventCode } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()
  await requireAnySection(event.id, event.code, ['hospitality', 'hamper'])
  return children
}
