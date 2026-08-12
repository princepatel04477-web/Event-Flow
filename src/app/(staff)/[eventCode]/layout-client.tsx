'use client'

import { useMemo, type ReactNode } from 'react'

import { SignOutButton } from '@/components/auth/SignOutButton'
import { AdminLink } from '@/components/nav/AdminLink'
import { BottomTabs } from '@/components/nav/BottomTabs'
import { EventSwitcher } from '@/components/nav/EventSwitcher'
import { StickyHeader } from '@/components/ui/StickyHeader'
import { SessionProvider, useSession, useRequireSession } from '@/lib/client/session-context'
import { EventProvider, useEvent } from '@/lib/client/event-context'
import { cn, formatDateRange } from '@/lib/utils'

type LayoutProps = {
  children: ReactNode
  params: Promise<{ eventCode: string }>
}

export function EventLayoutClient({ children, params }: LayoutProps) {
  return (
    <SessionProvider>
      <SessionGate children={children} params={params} />
    </SessionProvider>
  )
}

function SessionGate({ children }: { children: ReactNode; params?: Promise<{ eventCode: string }> }) {
  const session = useRequireSession()

  if (session.status === 'loading') {
    return <div className="flex min-h-dvh items-center justify-center bg-paper text-muted">Loading…</div>
  }

  if (session.status === 'anonymous') {
    return null
  }

  return <EventGate children={children} />
}

function EventGate({ children }: { children: ReactNode }) {
  const eventCode = useMemo(() => {
    if (typeof window === 'undefined') return ''
    const seg = window.location.pathname.split('/').filter(Boolean)
    return seg[0] ?? ''
  }, [])

  if (!eventCode) return null

  return (
    <EventProvider eventCode={eventCode}>
      <EventLayoutInner eventCode={eventCode}>{children}</EventLayoutInner>
    </EventProvider>
  )
}

function EventLayoutInner({ children, eventCode }: { children: ReactNode; eventCode: string }) {
  const eventCtx = useEvent()
  const session = useSession()

  if (eventCtx.status === 'loading') {
    return <div className="flex min-h-dvh items-center justify-center bg-paper text-muted">Loading…</div>
  }

  if (eventCtx.status === 'not-found') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-paper p-6 text-center">
        <h1 className="font-display text-2xl font-medium text-ink">Event not found</h1>
        <p className="mt-2 text-muted">This event doesn't exist or you don't have access to it.</p>
      </div>
    )
  }

  const { event, access } = eventCtx
  if (!event) return null

  const viewer = session.viewer
  const showTabs = access !== 'client'

  const subtitle = formatDateRange(event.starts_on, event.ends_on) ?? event.venue_city ?? event.code

  return (
    <div
      data-theme={access === 'client' ? 'client' : undefined}
      className="flex min-h-dvh flex-col bg-paper text-ink"
    >
      <StickyHeader
        title={event.name}
        subtitle={subtitle}
        right={
          <nav className="flex items-center gap-2" aria-label="Header actions">
            {viewer && viewer.memberships.length > 1 ? (
              <EventSwitcher
                events={viewer.memberships}
                currentCode={event.code}
                isAdmin={viewer.isAdmin}
              />
            ) : null}
            <AdminLink show={viewer?.isAdmin ?? false} />
            <span className="ml-0.5 border-l border-rule-strong pl-2.5">
              <SignOutButton compact />
            </span>
          </nav>
        }
      />

      <main className={cn('flex flex-1 flex-col px-safe', !showTabs && 'pb-safe')}>
        <div
          className={cn(
            'mx-auto flex w-full max-w-[480px] flex-1 flex-col px-4 pt-4',
            showTabs ? 'pb-nav' : 'pb-8',
          )}
        >
          {children}
        </div>
      </main>

      <BottomTabs eventCode={event.code} access={access === 'none' ? 'client' : access} />
    </div>
  )
}
