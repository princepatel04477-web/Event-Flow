import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'

import { requireSection } from '@/lib/auth/section-guard'
import { getEventAccess, resolveEventByCode } from '@/lib/supabase/queries'

type Props = {
  children: ReactNode
  params: Promise<{ eventCode: string }>
}

export default async function GuestsSectionLayout({ children, params }: Props) {
  const { eventCode } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  // A CLIENT IS ALLOWED THROUGH THIS LAYOUT, AND MUST BE.
  //
  // `requireSection` begins with `requireStaff`, and `requireStaff` sends a
  // client to `/{eventCode}/guests` — which is the page this layout wraps. So
  // the client's ONLY screen bounced them at itself, forever: the browser
  // re-requested the same URL every ~220ms, the route-level loading skeleton
  // never resolved, and a family login could not see the guest list at all.
  // Measured on a production build with the UI flag UNSET, so this is the live
  // v1 app and not the rebuild — the flag has nothing to do with it.
  //
  // `guests/page.tsx` already carries this same warning about putting
  // `requireStaff` on the page. The fix was applied to the page and missed the
  // layout above it, which is where the guard actually ran.
  //
  // Letting a client past this line exposes nothing: both pages that a client
  // may open branch on `getEventAccess` themselves (`guests/page.tsx` renders
  // `ClientGuestList`, `guests/list/page.tsx` does the same), and the other two
  // guard harder than this layout did — `guests/import` calls `requireAdmin`,
  // `guests/export` calls `requireStaff`.
  const access = await getEventAccess(event.id)
  if (access !== 'client') await requireSection(event.id, event.code, 'guests')

  return children
}
