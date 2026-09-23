import 'server-only'

import { notFound } from 'next/navigation'

import { requireSection } from '@/lib/auth/section-guard'
import { resolveEventByCode } from '@/lib/supabase/queries'

/**
 * The guard for the v2 Travel screens.
 *
 * WHY IT IS A FUNCTION AND NOT THE LEGACY LAYOUT SHIM. In v1 the section gate
 * lives in `(staff)/[eventCode]/logistics/layout.tsx`, and v2 used to re-export
 * that file as its own `logistics/layout.tsx`. That worked, but it put the
 * security of a whole v3 section behind a module specifier pointing into the
 * other route group — and `logistics/arrivals` was already not a shim, so it
 * never received it anyway and had to guard itself by hand.
 *
 * This is the same `requireSection(event.id, event.code, 'logistics')` call the
 * legacy layout makes, in one named place that every page in this section can
 * call. The guard itself is NOT reimplemented: `requireSection` reads
 * `sectionAllowedForDepartment`, which is the same table `v3TabsFor` emits tabs
 * from, so a tab the bar shows is a page this admits, and vice versa.
 *
 * `_guard.ts` is underscore-prefixed so the App Router does not treat it as a
 * route; `_components/` in this tree sets the same precedent.
 */
export async function requireTravelScreen(eventCode: string) {
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  await requireSection(event.id, event.code, 'logistics')

  return { event }
}

/** Every Travel page's params, so the routes agree on their shape. */
export type TravelPageProps = {
  params: Promise<{ eventCode: string }>
}
