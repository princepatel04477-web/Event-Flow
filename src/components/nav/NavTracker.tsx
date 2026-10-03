'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

import { recordVisit, setLanding } from '@/lib/nav/back'

/**
 * Records where the viewer has been in this session, and where they land, for
 * the Android back button (`@/lib/nav/back`, UI4 N4). Renders nothing.
 *
 * Mounted by the event shell, which is the one place that knows the viewer's
 * landing (Today for a lead, their own section for a runner).
 */
export function NavTracker({ landing }: { landing: string | null }) {
  const pathname = usePathname()

  useEffect(() => {
    if (landing) setLanding(landing)
  }, [landing])

  useEffect(() => {
    if (pathname) recordVisit(pathname)
  }, [pathname])

  return null
}

export default NavTracker
