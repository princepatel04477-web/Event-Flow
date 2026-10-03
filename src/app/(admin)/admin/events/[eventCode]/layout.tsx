import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'

import { resolveEventByCode } from '@/lib/supabase/queries'
import { v3TabsFor } from '@/lib/sections/v3'
import { AppTabs } from '@/app/(app)/v2/[eventCode]/_components/AppTabs'
import { NavTracker } from '@/components/nav/NavTracker'

type EventLayoutProps = {
  children: ReactNode
  params: Promise<{ eventCode: string }>
}

/**
 * Persistent event context for every /admin/events/[eventCode]/* screen.
 *
 * The event switcher already shows the code, but the wrong-event writes
 * happened with that on screen — the context was easy to tune out. This bar
 * renders the event name and code at the top of every event page, and banners
 * any event that is not the one named by NEXT_PUBLIC_LIVE_EVENT_CODE, so a
 * test event is impossible to mistake for the real one.
 */
export default async function EventLayout({ children, params }: EventLayoutProps) {
  const { eventCode } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  /**
   * Which event is the real one, from config rather than a literal.
   *
   * This was hardcoded to 'SHARMA26'. A hardcoded live event is wrong twice
   * over: it silently banners every OTHER event as a test — so the moment the
   * real wedding is not SHARMA26, the warning fires on the event people are
   * actually working, and stays quiet on the one they should be careful about.
   * That is worse than no warning, because staff learn to dismiss it.
   *
   * Unset means "do not claim to know", so nothing is flagged. A banner that
   * might be lying is not a safety feature; the honest states are "this is not
   * the live event" and silence.
   */
  const liveEventCode = process.env.NEXT_PUBLIC_LIVE_EVENT_CODE?.trim().toUpperCase()
  const isLive = !liveEventCode || event.code.toUpperCase() === liveEventCode

  return (
    <div className="flex flex-col gap-4">
      {/* The "Active event" strip that sat here is now the event pill in
          the header (UI4 Part S), on every admin screen and every app screen
          alike — one place the event is named, not two. */}

      {!isLive ? (
        <div
          role="alert"
          className="rounded-xl border border-ledger-amber/40 bg-amber-tint px-4 py-3 text-sm font-medium text-ledger-amber"
        >
          Not the live event — you are viewing {event.name} ({event.code}). Confirm before
          writing.
        </div>
      ) : null}

      {children}

      {/* The event's own tab bar, with Control lit (UI4 Part S). On a phone an
          admin tool is one of Control's screens, so the bar the admin arrived
          from stays under their thumb and one tap returns to Today, Calls or
          wherever they were. The admin layout guard above has already refused
          a non-admin, so the admin tab set is the right one to draw. Hidden at
          lg+, where the admin sidebar is the navigation. */}
      <AppTabs tabs={v3TabsFor(event.code, 'admin', 'management')} activeSection="control" />
      {/* Admin tools are Control's screens, so they join the same visit
          record the Android back button reads (UI4 N4). The landing is left
          as the event shell set it. */}
      <NavTracker landing={null} />
    </div>
  )
}
