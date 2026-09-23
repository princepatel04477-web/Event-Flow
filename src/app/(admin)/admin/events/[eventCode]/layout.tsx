import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'

import { resolveEventByCode } from '@/lib/supabase/queries'

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
      {/* One compact line, not a stacked eyebrow + title block. The bar still
          does its job — an admin three screens into the wrong wedding sees
          the name and code above every page — but it no longer reads as a
          second page title competing with the screen's own. */}
      <div className="flex min-h-11 flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-xl border border-rule bg-surface-2 px-4 py-2.5">
        <span className="eyebrow">Active event</span>
        <span className="min-w-0 truncate text-sm font-semibold text-ink">{event.name}</span>
        <span className="code-figure text-xs text-muted">{event.code}</span>
      </div>

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
    </div>
  )
}
