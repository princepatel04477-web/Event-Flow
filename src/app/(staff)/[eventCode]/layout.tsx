import { notFound, redirect } from 'next/navigation'
import type { ReactNode } from 'react'

import { SignOutButton } from '@/components/auth/SignOutButton'
import { BottomTabs } from '@/components/nav/BottomTabs'
import { EventSwitcher } from '@/components/nav/EventSwitcher'
import { StickyHeader } from '@/components/ui/StickyHeader'
import { getEventByCode, getViewer } from '@/lib/supabase/queries'
import { formatDateRange } from '@/lib/utils'

type LayoutProps = {
  children: ReactNode
  // Next 15+ hands params over as a Promise.
  params: Promise<{ eventCode: string }>
}

export default async function EventLayout({ children, params }: LayoutProps) {
  const { eventCode } = await params

  const [viewer, event] = await Promise.all([
    getViewer(),
    resolveEventByCode(eventCode),
  ])

  if (!viewer) {
    redirect(`/login?next=${encodeURIComponent(`/${eventCode}`)}`)
  }

  // getEventByCode runs under RLS. No row means "this code does not exist"
  // OR "you are not a member of it" — indistinguishable on purpose, and a
  // 404 is the right answer to both.
  if (!event) notFound()

  const subtitle =
    formatDateRange(event.starts_on, event.ends_on) ?? event.venue_city ?? event.code

  return (
    <>
      <StickyHeader
        title={event.name}
        subtitle={subtitle}
        right={
          <>
            {viewer.memberships.length > 1 ? (
              <EventSwitcher events={viewer.memberships} currentCode={event.code} />
            ) : null}
            <SignOutButton compact />
          </>
        }
      />

      {/* Two elements on purpose: the safe-area inset and the content gutter
          are both horizontal padding, so they cannot share a box. */}
      <main className="flex-1 px-safe">
        <div className="mx-auto w-full max-w-2xl px-4 pt-4 pb-nav">{children}</div>
      </main>

      <BottomTabs eventCode={event.code} />
    </>
  )
}

/**
 * Codes are short slugs like SHARMA26. Accept a lower-cased URL rather than
 * 404ing on someone who typed it by hand, then use the canonical `event.code`
 * for every link we render so the URL self-corrects on the next tap.
 */
async function resolveEventByCode(code: string) {
  const exact = await getEventByCode(code)
  if (exact) return exact

  const upper = code.toUpperCase()
  if (upper === code) return null

  return getEventByCode(upper)
}
