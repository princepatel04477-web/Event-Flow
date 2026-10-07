'use client'

import { useCallback, useMemo, useState } from 'react'

/**
 * Bound how many rows a long list mounts.
 *
 * THE COST THIS REMOVES. These lists render every row they are given, so a
 * rooming list of hundreds of rooms — or an arrivals board with a card per leg —
 * mounts hundreds of nodes in one commit. `docs/FEEL-BASELINE.md` measured that
 * cost directly: a 543-row list spent ~26 s mounting on a mid-range phone while
 * the database answered in 5 ms. The stutter is the MOUNT, not the data.
 *
 * WHY A CAP AND NOT A SCROLL WINDOW. A window needs a fixed row height and a
 * measured container. These rows are neither: a rooming-list row grows when its
 * guest-name cell wraps, and an arrival card grows when its suggestion panel
 * opens. `GuestsClient`'s hand-rolled window already gets this wrong (its
 * scroller is never bounded, so `onScroll` never fires) and a wrong window shows
 * a BLANK list — worse than a slow one on event day. A cap cannot mis-render: it
 * renders `min(rows, cap)` and offers "Show N more", which is exactly the
 * pattern `AllContacts` and `ClientGuestList` already use in this app.
 *
 * The cap only ever grows. A change to the underlying list is not special-cased,
 * because the bound is what matters and rendering the first `cap` rows is always
 * correct. Full scroll virtualisation for these screens is a device-verified
 * follow-up, not a guess.
 */
export function useCappedRows<T>(rows: readonly T[], page = 50) {
  const [limit, setLimit] = useState(page)

  const visible = useMemo(
    () => (rows.length <= limit ? rows : rows.slice(0, limit)),
    [rows, limit],
  )
  const remaining = Math.max(0, rows.length - limit)
  const showMore = useCallback(() => setLimit((n) => n + page), [page])

  return { visible, remaining, showMore }
}

export default useCappedRows
