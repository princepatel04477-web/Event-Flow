import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'

import { requireSection } from '@/lib/auth/section-guard'
import { resolveEventByCode } from '@/lib/supabase/queries'

type Props = {
  children: ReactNode
  params: Promise<{ eventCode: string }>
}

/**
 * The Hampers section's gate.
 *
 * WHY THIS FILE IS NOT A RE-EXPORT ANY MORE. It used to point at
 * `(staff)/[eventCode]/hamper/layout.tsx`, whose only job is
 * `requireSection(event.id, event.code, 'hamper')`. A re-export works, but it
 * makes the audience of a v3 tab a module specifier into the legacy tree — and
 * the v3 Hampers tab is the FIRST thing that sends anyone to `/{event}/hamper`
 * as their landing screen. In v1 the hamper department's post-login home was
 * `hospitality/deliveries`, so this gate was rarely reached; now it is on the
 * path of every hamper runner's first tap.
 *
 * The guard is the same call, made here: a hamper runner and an event lead get
 * in, a hospitality, travel or production runner is bounced to their own home
 * with `?denied=section`. `management` passes because `sectionAllowedForDepartment`
 * treats it as staff everywhere — which is what makes the Rooms → Hampers
 * borrowed link work for an event lead.
 *
 * The page underneath calls `requireHamperScreen` as well, which admits the
 * UNION of the hamper and hospitality departments. That is not a contradiction:
 * this layout is the narrow door for the section's own route, and the guard on
 * the page is the wider one the shared `HamperRun` needs. A hospitality runner
 * reaching `/{event}/hamper` directly is bounced here, which is correct — their
 * copy of the run is `/hospitality/deliveries`, and that is where the Rooms tab
 * points.
 */
export default async function HamperSectionLayout({ children, params }: Props) {
  const { eventCode } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()
  await requireSection(event.id, event.code, 'hamper')
  return children
}
