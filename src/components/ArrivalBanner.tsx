'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { readArrivalLegs } from '@/lib/actions/arrivals'
import { arrivalBanner, bannerText, type ArrivalLeg } from '@/lib/arrivals/banner'
import { createClient } from '@/lib/supabase/client'
import { ChevronRightIcon } from '@/components/icons'

/**
 * The in-app arrival banner (A9).
 *
 * Mounted once by the v2 shell for staff and shown only on Today and the
 * Logistics tree — the two places a coordinator is watching the door from. It
 * keeps itself current two ways: a Supabase Realtime subscription on
 * `travel_legs` (so an arrival marked on another phone appears here at once)
 * and a 60-second tick, because the "next 60 min" window slides even when
 * nothing is written.
 *
 * Tapping opens the arrivals board. If the admin has switched notifications off
 * it renders nothing, and the whole thing is a plain link, so it works with
 * JavaScript-degraded navigation like every other row.
 */
export function ArrivalBanner({
  eventId,
  eventCode,
  date,
  enabled,
}: {
  eventId: string
  eventCode: string
  /** Today, `YYYY-MM-DD`, resolved on the server. */
  date: string
  enabled: boolean
}) {
  const pathname = usePathname()
  const [legs, setLegs] = useState<ArrivalLeg[] | null>(null)
  const [now, setNow] = useState(() => new Date())

  const onRoute = pathname === `/${eventCode}` || pathname.startsWith(`/${eventCode}/logistics`)

  const refresh = useCallback(async () => {
    try {
      setLegs(await readArrivalLegs(eventId, date))
    } catch {
      // A failed read leaves the banner empty; it is a notice, not the screen.
    }
  }, [eventId, date])

  useEffect(() => {
    if (!enabled || !onRoute) return
    void refresh()
  }, [enabled, onRoute, refresh])

  useEffect(() => {
    if (!enabled || !onRoute) return

    const supabase = createClient()
    const channel = supabase
      .channel(`arrivals:${eventId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'travel_legs', filter: `event_id=eq.${eventId}` },
        () => {
          void refresh()
        },
      )
      .subscribe()

    const tick = setInterval(() => {
      setNow(new Date())
      void refresh()
    }, 60_000)

    return () => {
      void supabase.removeChannel(channel)
      clearInterval(tick)
    }
  }, [enabled, onRoute, eventId, refresh])

  if (!enabled || !onRoute || legs === null) return null

  const data = arrivalBanner(legs, now)
  if (!data) return null

  return (
    <Link
      href={`/${eventCode}/logistics/arrivals`}
      className="tap mb-3 flex items-center gap-3 rounded-xl border border-brand/40 bg-brand-tint px-3.5 py-3 text-sm font-semibold text-brand"
    >
      <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-brand" />
      <span className="min-w-0 flex-1 truncate">{bannerText(data)}</span>
      <ChevronRightIcon className="h-5 w-5 shrink-0" aria-hidden />
    </Link>
  )
}

export default ArrivalBanner
