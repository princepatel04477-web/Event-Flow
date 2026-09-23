import type { ReactNode } from 'react'

import { requireTravelScreen } from './_guard'

type Props = {
  children: ReactNode
  params: Promise<{ eventCode: string }>
}

/**
 * The Travel section's layout — and the ONE reason it exists is the guard.
 *
 * THIS FILE USED TO BE A RE-EXPORT of `(staff)/[eventCode]/logistics/layout.tsx`
 * — two lines pointing the route at the legacy layout so `requireSection` could
 * not drift. That works, but the guard was then a module specifier into the
 * other route group: nothing in this tree said who may open a Travel screen, and
 * `logistics/arrivals` had already stopped receiving it (it was not a shim) and
 * had to guard itself by hand. Now every page in this section calls
 * `requireTravelScreen` itself, and this layout is the belt to that pair of
 * braces: a page added here later cannot forget it.
 *
 * The real guard is not reimplemented — `requireTravelScreen` is
 * `requireSection(event.id, event.code, 'logistics')`, the same call the legacy
 * layout makes, reading the same `sectionAllowedForDepartment` table `v3TabsFor`
 * emits the Travel tab from.
 */
export default async function TravelSectionLayout({ children, params }: Props) {
  const { eventCode } = await params
  await requireTravelScreen(eventCode)
  return children
}
