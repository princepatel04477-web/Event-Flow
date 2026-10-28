import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { requireStaff, resolveEventByCode } from '@/lib/supabase/queries'

import { CaptureTestClient } from './CaptureTestClient'

export const metadata: Metadata = { title: 'Capture test' }

type PageProps = { params: Promise<{ eventCode: string }> }

/**
 * Per-handset check for automatic call capture.
 *
 * `requireStaff`, not an admin guard, and that is the point. Capture runs on
 * the ten cheap Android phones the calling team carries, and whether it works
 * is a property of EACH of those phones — the dialer's folder, its filename
 * format, whether All-files access can be granted. The existing harvest debug
 * screen sits under `(admin)`, which a code-auth team session cannot open at
 * all (CLAUDE.md §12), so it can only ever test the developer's own handset:
 * the one device nobody was worried about.
 */
export default async function CaptureTestPage({ params }: PageProps) {
  const { eventCode } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  await requireStaff(event.id, event.code)

  return <CaptureTestClient eventId={event.id} />
}
