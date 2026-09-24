import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'

import { requireAnySection } from '@/lib/auth/section-guard'
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
 * WHY THE GUARD IS THE UNION OF TWO SECTIONS, NOT `hamper` ALONE. This is the
 * screen the hamper RUN lives at, and the run has two audiences: the hamper
 * team, whose whole job it is, and the hospitality team, whose copy of it is
 * `hospitality/deliveries`. That second address redirects here, so gating this
 * layout with `hamper` alone turned a hospitality runner's bookmark into a
 * silent teleport to the Rooms board with `?denied=section` — a marker only the
 * dashboard renders, so the bounce read as a broken link (`docs/BUGS.md` M7).
 * `mayOpenHamperRun` is the one predicate for that union, shared with the
 * hospitality layout and the `deliveries` guard.
 *
 * Everyone who does not belong here still gets the same redirect:
 * travel, production and client are bounced to their own home with
 * `?denied=section`. `management` passes because
 * `sectionAllowedForDepartment` treats it as staff everywhere — which is what
 * makes the Rooms → Hampers borrowed link work for an event lead.
 */
export default async function HamperSectionLayout({ children, params }: Props) {
  const { eventCode } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()
  await requireAnySection(event.id, event.code, ['hamper', 'hospitality'])
  return children
}
