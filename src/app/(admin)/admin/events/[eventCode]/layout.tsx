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
      <div className="rounded-xl border border-rule bg-surface-2 px-4 py-2.5">
        <p className="font-mono text-[0.625rem] font-bold uppercase tracking-[0.1em] text-subtle">
          Active event
        </p>
        <p className="text-sm font-semibold text-fg">
          {event.name}{' '}
          <span className="font-mono text-xs font-normal text-muted">({event.code})</span>
        </p>
      </div>

      {!isLive ? (
        <div
          role="alert"
          className="rounded-xl border border-rule bg-tint-warning px-4 py-3 text-sm font-medium text-warning"
        >
          This is not the live event. You are viewing {event.name} ({event.code}) — confirm
          before writing anything.
        </div>
      ) : null}

      {children}
    </div>
  )
}
